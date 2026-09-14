import { api, ErroDaApi, type EventoDoSalao, type ResumoDoPeriodo } from "./api.js";
import { baixarCsv, montarCsv, type Celula } from "./csv.js";
import { exigir, trocar } from "./dom.js";
import { desenharFechamento } from "./fechamento.js";
import {
    dataDoSeletor,
    dataPorExtenso,
    fimDoDia,
    fimDoDiaDe,
    horaMinuto,
    inicioDoDia,
    inicioDoDiaDe
} from "./tempo.js";

/**
 * O fechamento do dia.
 *
 * Tela própria, e não janela sobre o painel, por uma razão prática: isto é para
 * imprimir e para exportar. Página inteira se imprime com CSS normal; janela
 * sobre o painel exigiria esconder o resto da tela na impressão, regra que
 * quebra ao primeiro elemento novo.
 *
 * Os números saem do diário, e não do estado do salão — é por isso que eles
 * sobrevivem a um reinício do serviço no meio do expediente, e é por isso que
 * dá para pedir ontem.
 */

/** Teto do que `/eventos` devolve de uma vez. Acima disso, o CSV sai cortado. */
const TETO_DO_DIARIO = 500;

interface Periodo {
    inicio: Date;
    fim: Date;
    /** Como o período se chama na tela e no nome do arquivo. */
    rotulo: string;
    arquivo: string;
}

function hoje(): Periodo {
    const agora = new Date();
    return {
        inicio: inicioDoDia(agora),
        fim: fimDoDia(agora),
        rotulo: `hoje — ${dataPorExtenso(agora)}`,
        arquivo: dataDoSeletor(agora)
    };
}

function ontem(): Periodo {
    // Um instante dentro de ontem, pego recuando do começo de hoje.
    const dentroDeOntem = new Date(inicioDoDia().getTime() - 60_000);
    return {
        inicio: inicioDoDia(dentroDeOntem),
        fim: fimDoDia(dentroDeOntem),
        rotulo: `ontem — ${dataPorExtenso(dentroDeOntem)}`,
        arquivo: dataDoSeletor(dentroDeOntem)
    };
}

function intervalo(de: string, ate: string): Periodo | string {
    const inicio = inicioDoDiaDe(de);
    const fim = fimDoDiaDe(ate);

    if (inicio === null || fim === null) {
        return "Escolha as duas datas.";
    }
    if (fim.getTime() <= inicio.getTime()) {
        return "A data final tem de ser igual ou posterior à inicial.";
    }

    // O fim é aberto: o último instante do período é um milissegundo antes.
    const ultimoDia = new Date(fim.getTime() - 1);
    const rotulo =
        de === ate ? dataPorExtenso(inicio) : `de ${dataPorExtenso(inicio)} a ${dataPorExtenso(ultimoDia)}`;

    return { inicio, fim, rotulo, arquivo: de === ate ? de : `${de}_a_${ate}` };
}

function csvDoResumo(resumo: ResumoDoPeriodo, periodo: Periodo): string {
    const numeros: (readonly Celula[])[] = [
        ["Período", periodo.rotulo],
        ["Grupos atendidos", resumo.gruposAtendidos],
        ["Pessoas atendidas", resumo.pessoasAtendidas],
        ["Espera média (s)", resumo.esperaMediaSegundos],
        ["Maior espera (s)", resumo.maiorEsperaSegundos],
        ["Pico da fila", resumo.picoDaFila],
        ["Desistências", resumo.desistencias],
        ["Mesas devolvidas", resumo.reservasCanceladas]
    ];

    const porMesa = resumo.porMesa.map((mesa) => [
        mesa.mesaNumero,
        mesa.capacidade,
        mesa.giros,
        mesa.permanenciaMediaSegundos,
        mesa.aproveitamentoPercentual
    ]);

    // Duas tabelas num arquivo só, separadas por uma linha em branco. Quem abre
    // isto abre no Excel para olhar a noite inteira de uma vez — e uma linha em
    // branco é o que qualquer planilha entende como "começa outra coisa aqui".
    return (
        montarCsv(["Indicador", "Valor"], numeros) +
        "\r\n" +
        montarCsv(["Mesa", "Lugares", "Giros", "Permanência média (s)", "Aproveitamento (%)"], porMesa)
    );
}

function csvDoDiario(eventos: readonly EventoDoSalao[]): string {
    // Sem telefone de propósito: este arquivo sai do salão, e o relatório do
    // dia não precisa de uma lista de contatos de clientes para ser útil.
    const linhas = [...eventos]
        .sort((a, b) => a.momento.localeCompare(b.momento))
        .map((evento) => [
            evento.momento,
            horaMinuto(new Date(evento.momento)),
            evento.tipo,
            evento.mesaNumero,
            evento.capacidade,
            evento.nome,
            evento.pessoas,
            evento.esperaEmSegundos,
            evento.permanenciaEmSegundos
        ]);

    return montarCsv(
        [
            "Momento (ISO)",
            "Hora",
            "Evento",
            "Mesa",
            "Lugares",
            "Nome",
            "Pessoas",
            "Espera (s)",
            "Permanência (s)"
        ],
        linhas
    );
}

class TelaDeFechamento {
    readonly #rotulo = exigir("#rotulo-do-periodo");
    readonly #conteudo = exigir("#conteudo");
    readonly #recado = exigir("#recado");
    readonly #campos = exigir("#campos-do-intervalo");
    readonly #de = exigir<HTMLInputElement>("#de");
    readonly #ate = exigir<HTMLInputElement>("#ate");

    #periodo: Periodo = hoje();
    #resumo: ResumoDoPeriodo | null = null;

    constructor() {
        const ontemTexto = dataDoSeletor(new Date(inicioDoDia().getTime() - 60_000));
        this.#de.value = ontemTexto;
        this.#ate.value = dataDoSeletor();

        for (const botao of document.querySelectorAll<HTMLButtonElement>("[data-periodo]")) {
            botao.addEventListener("click", () => this.#escolher(botao));
        }
        this.#de.addEventListener("change", () => this.#aplicarIntervalo());
        this.#ate.addEventListener("change", () => this.#aplicarIntervalo());

        exigir("#csv-resumo").addEventListener("click", () => this.#baixarResumo());
        exigir("#csv-diario").addEventListener("click", () => void this.#baixarDiario());
        exigir("#imprimir").addEventListener("click", () => window.print());
    }

    async iniciar(): Promise<void> {
        await this.#carregar();
    }

    #escolher(botao: HTMLButtonElement): void {
        for (const outro of document.querySelectorAll("[data-periodo]")) {
            outro.classList.toggle("escolhido", outro === botao);
        }

        const qual = botao.dataset["periodo"];
        this.#campos.hidden = qual !== "intervalo";

        if (qual === "hoje") {
            this.#periodo = hoje();
            void this.#carregar();
            return;
        }
        if (qual === "ontem") {
            this.#periodo = ontem();
            void this.#carregar();
            return;
        }
        this.#aplicarIntervalo();
    }

    #aplicarIntervalo(): void {
        const escolhido = intervalo(this.#de.value, this.#ate.value);
        if (typeof escolhido === "string") {
            this.#dizer(escolhido, "erro");
            return;
        }
        this.#periodo = escolhido;
        void this.#carregar();
    }

    async #carregar(): Promise<void> {
        this.#rotulo.textContent = this.#periodo.rotulo;
        this.#dizer("", "");

        try {
            this.#resumo = await api.relatorio(this.#periodo.inicio, this.#periodo.fim);
            trocar(this.#conteudo, desenharFechamento(this.#resumo));
        } catch (erro) {
            this.#resumo = null;
            trocar(this.#conteudo);
            this.#dizer(
                erro instanceof ErroDaApi ? erro.message : "Não foi possível falar com o painel.",
                "erro"
            );
        }
    }

    #baixarResumo(): void {
        const resumo = this.#resumo;
        if (resumo === null) {
            return;
        }
        baixarCsv(`fechamento-${this.#periodo.arquivo}.csv`, csvDoResumo(resumo, this.#periodo));
    }

    /**
     * O diário só é buscado quando alguém pede o arquivo: são centenas de
     * linhas que a tela não mostra, e trazê-las a cada troca de período seria
     * pagar por um download que talvez nunca aconteça.
     */
    async #baixarDiario(): Promise<void> {
        this.#dizer("Montando o diário…", "");

        try {
            const pagina = await api.eventos(this.#periodo.inicio, this.#periodo.fim, TETO_DO_DIARIO);
            baixarCsv(`diario-${this.#periodo.arquivo}.csv`, csvDoDiario(pagina.itens));

            const cortado = pagina.total > pagina.itens.length;
            this.#dizer(
                cortado
                    ? `O período tem ${pagina.total} eventos e o arquivo levou os ` +
                          `${pagina.itens.length} mais recentes. Peça um período menor para levar tudo.`
                    : `${pagina.total} eventos no arquivo.`,
                cortado ? "aviso" : ""
            );
        } catch (erro) {
            this.#dizer(
                erro instanceof ErroDaApi ? erro.message : "Não foi possível falar com o painel.",
                "erro"
            );
        }
    }

    #dizer(texto: string, tom: string): void {
        this.#recado.textContent = texto;
        // `nao-imprimir` tem de sobreviver à troca de classe: o recado é
        // conversa com quem está na tela — "montando o diário…", "o arquivo
        // saiu cortado" — e não parte do relatório que vai para o papel.
        this.#recado.className = `recado nao-imprimir${tom === "" ? "" : ` recado--${tom}`}`;
        this.#recado.hidden = texto === "";
    }
}

try {
    void new TelaDeFechamento().iniciar();
} catch (erro) {
    const recado = `A tela não conseguiu iniciar: ${erro instanceof Error ? erro.message : String(erro)}`;
    const alvo = document.querySelector("#recado");
    if (alvo instanceof HTMLElement) {
        alvo.textContent = recado;
        alvo.hidden = false;
    } else {
        document.body.textContent = recado;
    }
}
