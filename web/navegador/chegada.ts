import type { Previsao } from "./api.js";
import { el } from "./dom.js";

/**
 * O formulário de quem chegou, com a prévia da decisão.
 *
 * Três campos e nada mais: nome, quantas pessoas, telefone. O telefone é
 * obrigatório porque é por ele que o salão reconhece a pessoa — é a identidade
 * do cliente no domínio, não um detalhe de contato.
 *
 * Enquanto se digita, uma linha diz onde o grupo vai parar. Essa resposta vem
 * do serviço, de uma consulta que não muda nada: recalcular aqui "a menor
 * mesa que serve, salvo se alguém na fila cabe nela" seria uma segunda cópia da
 * regra, e no dia em que a regra mudasse a tela passaria a prometer mesa que o
 * salão não daria. Quem decide entre mesa e fila é o salão, na prévia e na
 * chegada de verdade.
 */

/** Espera o dedo parar antes de perguntar: um pedido por tecla é desperdício. */
const ESPERA_ANTES_DE_PERGUNTAR_EM_MS = 250;

export interface Chegada {
    nome: string;
    pessoas: number;
    telefone: string;
}

export interface FormularioDeChegada {
    corpo: HTMLElement;
    /** Lê o que está nos campos. Vazio ou inválido vira erro do serviço. */
    ler(): Chegada;
    /** Cancela a consulta pendente quando a janela fecha. */
    encerrar(): void;
}

export type PerguntarPrevia = (pessoas: number, telefone: string) => Promise<Previsao>;

function campo(rotulo: string, entrada: HTMLInputElement): HTMLElement {
    const id = `campo-${entrada.name}`;
    entrada.id = id;
    return el(
        "label",
        { classe: "campo", atributos: { for: id } },
        el("span", { classe: "rotulo", texto: rotulo }),
        entrada
    );
}

function entrada(nome: string, tipo: string, atributos: Record<string, string>): HTMLInputElement {
    const no = el("input", { classe: "campo__entrada", atributos: { type: tipo, ...atributos } });
    no.name = nome;
    return no;
}

/**
 * A prévia em uma frase. O texto é escolhido aqui porque é apresentação; o
 * serviço manda o fato — `destino` e, na recusa, o `motivo`, que é o mesmo
 * `tipo` do erro que a chegada de verdade daria.
 */
function frasePara(previsao: Previsao, pessoas: number): { texto: string; tom: string } {
    if (previsao.destino === "mesa") {
        const mesa = previsao.mesa;
        return {
            tom: "mesa",
            texto: mesa === null ? "Senta numa mesa livre." : `Senta na mesa ${mesa.numero}.`
        };
    }

    if (previsao.destino === "fila") {
        return { tom: "fila", texto: `Entra na fila, na posição ${previsao.posicao}.` };
    }

    switch (previsao.motivo) {
        case "ClienteJaNoSalao":
            return {
                tom: "recusa",
                texto:
                    previsao.mesa === null
                        ? "Este telefone já está sentado."
                        : `Este telefone já está na mesa ${previsao.mesa.numero}.`
            };
        case "ClienteJaNaFila":
            return { tom: "recusa", texto: "Este telefone já está na fila." };
        case "GrupoSemMesaPossivel":
            return {
                tom: "recusa",
                texto: `Nenhuma mesa do salão comporta ${pessoas} pessoas.`
            };
        default:
            return { tom: "recusa", texto: "O salão não aceitaria esta chegada." };
    }
}

export function formularioDeChegada(perguntar: PerguntarPrevia): FormularioDeChegada {
    const nome = entrada("nome", "text", { autocomplete: "off", placeholder: "Marcos e amigos" });
    const pessoas = entrada("pessoas", "number", { min: "1", step: "1", value: "2" });
    const telefone = entrada("telefone", "tel", {
        autocomplete: "off",
        placeholder: "+55 11 99999-9999"
    });

    const previa = el("p", { classe: "previa" });
    const ler = (): Chegada => ({
        nome: nome.value.trim(),
        // Campo vazio dá NaN, que o serviço recusa com a mensagem certa —
        // melhor do que esta tela inventar um número.
        pessoas: Number.parseInt(pessoas.value, 10),
        telefone: telefone.value.trim()
    });

    let agendada: ReturnType<typeof setTimeout> | null = null;
    // Cada consulta leva um número. Resposta de pedido velho que chega depois
    // de um novo é descartada: sem isso, digitar "4" logo após "2" podia deixar
    // na tela a resposta do "2".
    let ultimoPedido = 0;

    const mostrar = (texto: string, tom: string): void => {
        previa.textContent = texto;
        previa.className = texto === "" ? "previa" : `previa previa--${tom}`;
    };

    const consultar = (): void => {
        const { pessoas: quantas, telefone: numero } = ler();
        if (!Number.isInteger(quantas) || quantas < 1) {
            mostrar("", "");
            return;
        }

        const meuPedido = ++ultimoPedido;
        void perguntar(quantas, numero).then(
            (previsao) => {
                if (meuPedido === ultimoPedido) {
                    const { texto, tom } = frasePara(previsao, quantas);
                    mostrar(texto, tom);
                }
            },
            () => {
                // Prévia é conforto, não requisito: se o serviço não responder,
                // a linha some e o botão continua valendo.
                if (meuPedido === ultimoPedido) {
                    mostrar("", "");
                }
            }
        );
    };

    const agendar = (): void => {
        if (agendada !== null) {
            clearTimeout(agendada);
        }
        agendada = setTimeout(consultar, ESPERA_ANTES_DE_PERGUNTAR_EM_MS);
    };

    // Só o tamanho do grupo e o telefone mudam a resposta; o nome, não.
    pessoas.addEventListener("input", agendar);
    telefone.addEventListener("input", agendar);

    const corpo = el(
        "div",
        { classe: "formulario" },
        campo("Nome do grupo", nome),
        campo("Pessoas", pessoas),
        campo("Telefone", telefone),
        previa
    );

    // A primeira resposta sai na hora: o campo já nasce com um valor.
    consultar();

    return {
        corpo,
        ler,
        encerrar: () => {
            if (agendada !== null) {
                clearTimeout(agendada);
            }
            ultimoPedido += 1;
        }
    };
}
