import {
    api,
    ErroDaApi,
    type EventoDoSalao,
    type InfoMesa,
    type ItemFilaJson,
    type RelatorioDoSalao,
    type ResumoDoPeriodo
} from "./api.js";
import { normalizarTermo } from "./busca.js";
import { formularioDeChegada } from "./chegada.js";
import { desenharDiario } from "./diario.js";
import { el, exigir, trocar } from "./dom.js";
import { desenharFila } from "./fila.js";
import { Modal } from "./modal.js";
import { desenharPlanta } from "./planta.js";
import { atualizarRelogios } from "./relogios.js";
import { dataPorExtenso, duracao, fimDoDia, horaMinuto, inicioDoDia } from "./tempo.js";

/**
 * O painel do maître.
 *
 * A regra que organiza este arquivo inteiro é o **desenho por região**. A tela
 * se atualiza sozinha a cada poucos segundos, e o que a atualização substitui é
 * só o que veio do serviço: a planta, os números, o diário e a fila. A caixa de
 * busca e a janela de ação ficam de fora, e ficam de fora de propósito — um
 * painel que apagasse o nome sendo digitado, ou que fechasse a janela no meio
 * de uma decisão, perderia a confiança de quem opera em um expediente. Por isso
 * também os cliques são ouvidos nos contêineres, e não nos cartões: os cartões
 * são trocados, os contêineres não.
 *
 * O outro par é o relógio. Desenho vem da rede; contagem regressiva vem de um
 * tique local de um segundo que só reescreve texto. Assim o prazo de quem foi
 * chamado corre liso mesmo com a rede engasgando.
 */

const INTERVALO_DA_ATUALIZACAO_EM_MS = 3_000;

/** Quantas linhas do diário cabem na lateral sem virar rolagem. */
const EVENTOS_NA_TELA = 12;

/** A partir daqui a casa está cheia e a fila é que manda no ritmo. */
const OCUPACAO_QUENTE = 80;
const OCUPACAO_MORNA = 50;

interface Estado {
    salao: RelatorioDoSalao;
    fila: ItemFilaJson[];
    eventos: EventoDoSalao[];
    resumo: ResumoDoPeriodo;
    lidoEm: Date;
}

interface Cartao {
    rotulo: string;
    valor: string;
    nota: string;
    tom: "neutro" | "livre" | "atencao" | "quente";
}

/**
 * "14 min" vira o número grande e a unidade pequena. O cartão é lido de
 * relance, e de relance o que importa é o 14 — a unidade só desempata.
 */
function separarUnidade(valor: string): [string, string | null] {
    const corte = valor.lastIndexOf(" ");
    return corte === -1 ? [valor, null] : [valor.slice(0, corte), valor.slice(corte + 1)];
}

function cartao({ rotulo, valor, nota, tom }: Cartao): HTMLElement {
    const [numero, unidade] = separarUnidade(valor);

    return el(
        "div",
        { classe: `cartao cartao--${tom}` },
        el("span", { classe: "rotulo", texto: rotulo }),
        el(
            "span",
            { classe: "cartao__valor mono", texto: numero },
            unidade === null ? false : el("span", { classe: "cartao__unidade", texto: unidade })
        ),
        el("span", { classe: "cartao__nota", texto: nota })
    );
}

function tomDaOcupacao(percentual: number): Cartao["tom"] {
    if (percentual >= OCUPACAO_QUENTE) {
        return "quente";
    }
    return percentual >= OCUPACAO_MORNA ? "atencao" : "neutro";
}

const plural = (quantidade: number, singular: string, plural: string): string =>
    quantidade === 1 ? singular : plural;

export class Painel {
    readonly #regiao = {
        relogio: exigir("#relogio"),
        aviso: exigir("#aviso"),
        planta: exigir("#planta"),
        cartoes: exigir("#cartoes"),
        diario: exigir("#diario"),
        fila: exigir("#fila")
    };
    readonly #busca = exigir<HTMLInputElement>("#busca");
    readonly #modal: Modal;

    #estado: Estado | null = null;
    #termo = "";
    #semContato: string | null = null;
    #buscando = false;

    constructor() {
        this.#modal = new Modal(exigir("#modal"), () => void this.#atualizar());

        this.#busca.addEventListener("input", () => {
            this.#termo = normalizarTermo(this.#busca.value);
            // Redesenha com o que já está em mãos: procurar alguém no balcão
            // não pode depender de a rede responder.
            this.#desenhar();
        });

        // Ouvindo no contêiner, e não no cartão: o cartão é substituído a cada
        // atualização, o contêiner fica.
        this.#regiao.planta.addEventListener("click", (evento) => {
            const id = this.#atributoDoAlvo(evento, ".mesa", "mesa");
            if (id !== undefined) {
                this.#abrirMesa(id);
            }
        });
        this.#regiao.fila.addEventListener("click", (evento) => {
            const telefone = this.#atributoDoAlvo(evento, "[data-telefone]", "telefone");
            if (telefone !== undefined) {
                this.#abrirEspera(telefone);
            }
        });

        exigir("#chegou").addEventListener("click", () => this.#abrirChegada());
        document.addEventListener("keydown", (evento) => this.#aoTeclar(evento));
    }

    async iniciar(): Promise<void> {
        this.#relogioDoCabecalho();
        await this.#atualizar();

        setInterval(() => {
            this.#relogioDoCabecalho();
            atualizarRelogios(document.body);
        }, 1_000);

        setInterval(() => void this.#atualizar(), INTERVALO_DA_ATUALIZACAO_EM_MS);
    }

    #atributoDoAlvo(evento: Event, seletor: string, dado: string): string | undefined {
        const alvo = evento.target;
        if (!(alvo instanceof Element)) {
            return undefined;
        }
        return alvo.closest<HTMLElement>(seletor)?.dataset[dado];
    }

    /**
     * Uma ida à rede por atualização, com as quatro leituras em paralelo. O
     * guarda evita empilhar buscas quando o serviço está lento: a atualização
     * seguinte simplesmente espera a vez.
     */
    async #atualizar(): Promise<void> {
        if (this.#buscando) {
            return;
        }
        this.#buscando = true;

        const de = inicioDoDia();
        const ate = fimDoDia();

        try {
            const [salao, fila, diario, resumo] = await Promise.all([
                api.salao(),
                api.fila(),
                api.eventos(de, ate, EVENTOS_NA_TELA),
                api.relatorio(de, ate)
            ]);
            this.#estado = {
                salao,
                fila: fila.itens,
                eventos: diario.itens,
                resumo,
                lidoEm: new Date()
            };
            this.#semContato = null;
        } catch (erro) {
            // O estado anterior fica na tela de propósito: num salão cheio,
            // o último retrato conhecido vale mais do que uma tela em branco —
            // desde que fique claro que é antigo, o que o aviso diz.
            this.#semContato =
                erro instanceof ErroDaApi ? erro.message : "Falha inesperada ao falar com o painel.";
        } finally {
            this.#buscando = false;
        }

        this.#desenhar();
    }

    #desenhar(): void {
        this.#desenharAviso();

        const estado = this.#estado;
        if (estado === null) {
            trocar(this.#regiao.planta, el("p", { classe: "planta__vazia", texto: "Falando com o salão…" }));
            return;
        }

        trocar(this.#regiao.planta, ...desenharPlanta(estado.salao.mesas, this.#termo));
        trocar(this.#regiao.cartoes, ...this.#cartoes(estado));
        trocar(this.#regiao.diario, ...desenharDiario(estado.eventos));
        trocar(this.#regiao.fila, ...desenharFila(estado.fila, estado.salao.mesas, this.#termo));

        // Os relógios nascem vazios: quem escreve neles é sempre o tique, para
        // que exista um lugar só decidindo o que cada contagem diz.
        atualizarRelogios(document.body);
    }

    #desenharAviso(): void {
        const aviso = this.#regiao.aviso;
        const recado = this.#semContato;

        if (recado === null) {
            aviso.hidden = true;
            aviso.replaceChildren();
            return;
        }

        const lidoEm = this.#estado?.lidoEm;
        trocar(
            aviso,
            el("strong", { texto: "Sem contato com o salão. " }),
            el("span", {
                texto:
                    lidoEm === undefined
                        ? recado
                        : `${recado} A tela mostra o estado das ${horaMinuto(lidoEm)}.`
            })
        );
        aviso.hidden = false;
    }

    #cartoes(estado: Estado): HTMLElement[] {
        const mesas = estado.salao.mesas;
        const livres = mesas.filter((mesa) => mesa.status === "DISPONIVEL");
        const maiorLivre = livres.reduce<InfoMesa | null>(
            (maior, mesa) => (maior === null || mesa.capacidade > maior.capacidade ? mesa : maior),
            null
        );
        const pessoasNaFila = estado.fila.reduce((soma, item) => soma + item.cliente.quantidadePessoas, 0);
        const ocupadas = mesas.length - livres.length;
        const naFila = estado.salao.tamanhoFila;
        const atendidos = estado.resumo.gruposAtendidos;

        return [
            cartao({
                rotulo: "Ocupação",
                valor: `${estado.salao.taxaOcupacaoPercentual}%`,
                nota: `${ocupadas} de ${mesas.length} ${plural(mesas.length, "mesa", "mesas")}`,
                tom: tomDaOcupacao(estado.salao.taxaOcupacaoPercentual)
            }),
            cartao({
                rotulo: "Maior mesa livre",
                valor: maiorLivre === null ? "—" : String(maiorLivre.capacidade),
                nota: maiorLivre === null ? "nenhuma mesa livre" : `lugares · mesa ${maiorLivre.numero}`,
                tom: maiorLivre === null ? "quente" : "livre"
            }),
            cartao({
                rotulo: "Espera média",
                // Do diário, e não do contador em memória do salão: assim o
                // número é o de hoje e sobrevive a um reinício do serviço.
                valor: duracao(estado.resumo.esperaMediaSegundos),
                nota: `hoje · ${atendidos} ${plural(atendidos, "atendido", "atendidos")}`,
                tom: "atencao"
            }),
            cartao({
                rotulo: "Na fila",
                valor: String(naFila),
                nota:
                    `${plural(naFila, "grupo", "grupos")} · ` +
                    `${pessoasNaFila} ${plural(pessoasNaFila, "pessoa", "pessoas")}`,
                tom: naFila === 0 ? "neutro" : "atencao"
            })
        ];
    }

    #abrirMesa(id: string): void {
        const mesa = this.#estado?.salao.mesas.find((candidata) => candidata.id === id);
        if (mesa === undefined) {
            return;
        }

        const titulo = `Mesa ${mesa.numero} · ${mesa.capacidade} lugares`;
        const desde = horaMinuto(new Date(mesa.desde));
        const cliente = mesa.cliente;
        const pessoas = cliente?.quantidadePessoas ?? 0;
        const quem =
            cliente === null
                ? "sem ninguém"
                : `${cliente.nome} · ${pessoas} ${plural(pessoas, "pessoa", "pessoas")}`;

        if (mesa.status === "DISPONIVEL") {
            this.#modal.abrir({
                titulo,
                nota:
                    `Livre desde as ${desde}. Quem chegar e couber senta aqui sozinho — ` +
                    "ou use o botão Chegou alguém.",
                acoes: []
            });
            return;
        }

        if (mesa.status === "RESERVADA") {
            this.#modal.abrir({
                titulo,
                nota: `${quem}. Chamada às ${desde}.`,
                acoes: [
                    {
                        rotulo: "Sentou",
                        confirmar: false,
                        tom: "principal",
                        executar: async () => {
                            await api.ocupar(mesa.id);
                            return "";
                        }
                    },
                    {
                        rotulo: "Devolver para a fila",
                        confirmar: true,
                        tom: "perigo",
                        executar: async () => {
                            const { atendido } = await api.cancelarReserva(mesa.id);
                            return atendido === null
                                ? `Mesa ${mesa.numero} devolvida. Ninguém na fila cabia nela.`
                                : `Mesa ${mesa.numero} devolvida e chamada para ${atendido.nome}.`;
                        }
                    }
                ]
            });
            return;
        }

        this.#modal.abrir({
            titulo,
            nota: `${quem}. Na mesa desde as ${desde}.`,
            acoes: [
                {
                    rotulo: "Liberou a mesa",
                    confirmar: true,
                    tom: "principal",
                    executar: async () => {
                        const { atendido } = await api.liberar(mesa.id);
                        return atendido === null
                            ? `Mesa ${mesa.numero} liberada. Ninguém na fila cabia nela.`
                            : `Mesa ${mesa.numero} liberada e chamada para ${atendido.nome}.`;
                    }
                }
            ]
        });
    }

    #abrirEspera(telefone: string): void {
        const item = this.#estado?.fila.find((candidato) => candidato.cliente.telefone === telefone);
        if (item === undefined) {
            return;
        }

        const pessoas = item.cliente.quantidadePessoas;
        this.#modal.abrir({
            titulo: item.cliente.nome,
            nota:
                `${pessoas} ${plural(pessoas, "pessoa", "pessoas")} · ` +
                `na fila desde as ${horaMinuto(new Date(item.dataEntrada))} · ${item.cliente.telefone}`,
            acoes: [
                {
                    rotulo: "Saiu da fila",
                    confirmar: true,
                    tom: "perigo",
                    executar: async () => {
                        await api.sairDaFila(telefone);
                        return "";
                    }
                }
            ]
        });
    }

    #abrirChegada(): void {
        const formulario = formularioDeChegada((pessoas, telefone) => api.previa(pessoas, telefone));

        this.#modal.abrir({
            titulo: "Chegou alguém",
            nota: "Quem decide entre mesa e fila é o salão, por ordem de chegada.",
            corpo: formulario.corpo,
            aoFechar: () => formulario.encerrar(),
            acoes: [
                {
                    rotulo: "Receber",
                    confirmar: false,
                    tom: "principal",
                    executar: async () => {
                        const { nome, pessoas, telefone } = formulario.ler();
                        const recepcao = await api.chegada(nome, pessoas, telefone);
                        return recepcao.destino === "mesa"
                            ? `${nome} sentou na mesa ${recepcao.mesa.numero}.`
                            : `${nome} entrou na fila, na posição ${recepcao.posicao}.`;
                    }
                }
            ]
        });
    }

    #aoTeclar(evento: KeyboardEvent): void {
        if (evento.key === "Escape") {
            if (this.#modal.aberto) {
                this.#modal.fechar();
            } else if (this.#busca.value !== "") {
                this.#busca.value = "";
                this.#termo = "";
                this.#desenhar();
            }
            return;
        }

        // "/" cai na busca, como em qualquer painel que se lê o dia todo — mas
        // não quando já se está digitando em algum campo.
        if (evento.key !== "/" || this.#modal.aberto) {
            return;
        }
        if (document.activeElement instanceof HTMLInputElement) {
            return;
        }
        evento.preventDefault();
        this.#busca.focus();
        this.#busca.select();
    }

    #relogioDoCabecalho(): void {
        const agora = new Date();
        this.#regiao.relogio.textContent = `${dataPorExtenso(agora)} · ${horaMinuto(agora)}`;
    }
}
