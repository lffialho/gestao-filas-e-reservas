import type { InfoMesa, Posicao } from "./api.js";
import { el } from "./dom.js";
import { COLUNAS, LINHAS } from "./planta.js";

/**
 * Montar o salão: pôr mesa na planta, arrastar para o lugar e tirar da planta.
 *
 * Separado do modo de operar de propósito. Quem opera clica em mesa a noite
 * inteira para sentar e liberar gente; se arrastar também mexesse na planta,
 * um dedo escorregando no tablet mudaria o salão no meio do movimento. Então
 * montar é um modo à parte, que se liga e se desliga — e enquanto ele está
 * ligado, clicar numa mesa não senta ninguém.
 */

/** Abaixo disso o dedo tremeu; não foi arrasto, foi toque. */
const FOLGA_DO_TOQUE_EM_PIXELS = 4;

export interface Arrasto {
    mesaId: string;
    destino: Posicao;
}

export interface OpcoesDoArrasto {
    /** A planta, para converter pixel em ladrilho. */
    planta: HTMLElement;
    /** Chamado quando o arrasto termina em outro ladrilho. */
    aoSoltar: (arrasto: Arrasto) => void;
    /** Avisa que um arrasto começou e terminou, para o poll não atrapalhar. */
    aoMudarEstado: (arrastando: boolean) => void;
    /** Toque sem arrasto: é clique, e quem chama decide o que fazer. */
    aoTocar: (mesaId: string) => void;
}

/** Em que ladrilho cai um ponto da tela, preso dentro da planta. */
function ladrilhoDe(
    planta: HTMLElement,
    x: number,
    y: number,
    vaoColunas: number,
    vaoLinhas: number
): Posicao {
    const caixa = planta.getBoundingClientRect();
    const coluna = Math.floor(((x - caixa.left) / caixa.width) * COLUNAS);
    const linha = Math.floor(((y - caixa.top) / caixa.height) * LINHAS);

    return {
        coluna: Math.min(Math.max(0, coluna), COLUNAS - vaoColunas),
        linha: Math.min(Math.max(0, linha), LINHAS - vaoLinhas)
    };
}

/**
 * Liga o arrastar de mesas na planta.
 *
 * Usa eventos de ponteiro, e não `draggable`, porque a planta é para dedo em
 * tablet tanto quanto para mouse — e `setPointerCapture` mantém o arrasto
 * mesmo quando o dedo sai de cima da mesa, que é o que acontece o tempo todo
 * ao arrastar uma mesa pequena.
 */
export function ligarArrasto(opcoes: OpcoesDoArrasto): () => void {
    const { planta, aoSoltar, aoMudarEstado, aoTocar } = opcoes;

    let mesa: HTMLElement | null = null;
    let mesaId = "";
    let deslocX = 0;
    let deslocY = 0;
    let comecouEm = { x: 0, y: 0 };
    let arrastou = false;
    let ultimo: Posicao | null = null;

    const aoDescer = (evento: PointerEvent): void => {
        const alvo = evento.target;
        if (!(alvo instanceof Element)) {
            return;
        }
        const candidata = alvo.closest<HTMLElement>(".mesa");
        const id = candidata?.dataset["mesa"];
        if (candidata === null || candidata === undefined || id === undefined) {
            return;
        }

        const caixa = candidata.getBoundingClientRect();
        mesa = candidata;
        mesaId = id;
        deslocX = evento.clientX - caixa.left;
        deslocY = evento.clientY - caixa.top;
        comecouEm = { x: evento.clientX, y: evento.clientY };
        arrastou = false;
        ultimo = null;

        candidata.setPointerCapture(evento.pointerId);
        evento.preventDefault();
    };

    const aoMover = (evento: PointerEvent): void => {
        if (mesa === null) {
            return;
        }

        const andou =
            Math.abs(evento.clientX - comecouEm.x) > FOLGA_DO_TOQUE_EM_PIXELS ||
            Math.abs(evento.clientY - comecouEm.y) > FOLGA_DO_TOQUE_EM_PIXELS;

        if (!arrastou && !andou) {
            return;
        }
        if (!arrastou) {
            arrastou = true;
            mesa.classList.add("mesa--arrastando");
            // Só agora o poll é avisado: enquanto foi toque, nada mudou.
            aoMudarEstado(true);
        }

        const vaoColunas = Math.round((parseFloat(mesa.style.width) / 100) * COLUNAS);
        const vaoLinhas = Math.round((parseFloat(mesa.style.height) / 100) * LINHAS);
        const destino = ladrilhoDe(
            planta,
            evento.clientX - deslocX,
            evento.clientY - deslocY,
            vaoColunas,
            vaoLinhas
        );

        ultimo = destino;
        mesa.style.left = `${(destino.coluna / COLUNAS) * 100}%`;
        mesa.style.top = `${(destino.linha / LINHAS) * 100}%`;
    };

    const aoSubir = (): void => {
        if (mesa === null) {
            return;
        }

        const arrastada = arrastou;
        const destino = ultimo;
        const id = mesaId;

        mesa.classList.remove("mesa--arrastando");
        mesa = null;
        ultimo = null;

        if (!arrastada) {
            aoTocar(id);
            return;
        }

        aoMudarEstado(false);
        if (destino !== null) {
            aoSoltar({ mesaId: id, destino });
        }
    };

    planta.addEventListener("pointerdown", aoDescer);
    planta.addEventListener("pointermove", aoMover);
    planta.addEventListener("pointerup", aoSubir);
    planta.addEventListener("pointercancel", aoSubir);

    return () => {
        planta.removeEventListener("pointerdown", aoDescer);
        planta.removeEventListener("pointermove", aoMover);
        planta.removeEventListener("pointerup", aoSubir);
        planta.removeEventListener("pointercancel", aoSubir);
    };
}

export interface FormularioDeMesa {
    corpo: HTMLElement;
    ler(): { numero: number; capacidade: number };
}

function campo(rotulo: string, entrada: HTMLInputElement, dica: string): HTMLElement {
    const id = `mesa-${entrada.name}`;
    entrada.id = id;
    return el(
        "label",
        { classe: "campo", atributos: { for: id } },
        el("span", { classe: "rotulo", texto: rotulo }),
        entrada,
        el("span", { classe: "campo__dica", texto: dica })
    );
}

/**
 * O menor número de mesa que ainda não existe. Numerar mesa é trabalho chato e
 * sem graça: sugerir o próximo livre faz a montagem de um salão de trinta
 * mesas ser trinta cliques em vez de trinta decisões.
 */
export function proximoNumeroLivre(mesas: readonly InfoMesa[]): number {
    const usados = new Set(mesas.map((mesa) => mesa.numero));
    let numero = 1;
    while (usados.has(numero)) {
        numero += 1;
    }
    return numero;
}

export function formularioDeMesa(numeroSugerido: number): FormularioDeMesa {
    const numero = el("input", {
        classe: "campo__entrada",
        atributos: { type: "number", min: "1", step: "1", value: String(numeroSugerido) }
    });
    numero.name = "numero";

    const capacidade = el("input", {
        classe: "campo__entrada",
        atributos: { type: "number", min: "1", step: "1", value: "4" }
    });
    capacidade.name = "capacidade";

    const corpo = el(
        "div",
        { classe: "formulario" },
        campo("Número da mesa", numero, "é o que a equipe usa para se referir a ela"),
        campo("Lugares", capacidade, "quantas pessoas sentam")
    );

    return {
        corpo,
        ler: () => ({
            numero: Number.parseInt(numero.value, 10),
            capacidade: Number.parseInt(capacidade.value, 10)
        })
    };
}
