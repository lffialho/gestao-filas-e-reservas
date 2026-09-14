import { contagem, duracao, segundosDesde } from "./tempo.js";

/**
 * Os relógios que correm na tela.
 *
 * Separados do desenho de propósito. O painel se atualiza pela rede a cada
 * poucos segundos, e contagem regressiva que só anda quando a rede responde
 * fica tremendo à vista de quem opera. Então quem desenha só marca o elemento
 * com `data-relogio` e `data-desde`, e daqui de segundo em segundo se reescreve
 * **apenas o texto** — nenhum nó é criado, nenhum é destruído, e nada perde
 * foco por causa de um relógio.
 */

/**
 * Quanto tempo quem foi chamado tem para aparecer na mesa.
 *
 * O prazo mora no painel, e não no serviço, por escolha: quando ele estoura
 * nada acontece sozinho. A mesa fica marcada e o maître decide. Quem foi
 * chamado pode estar estacionando o carro, e um cancelamento automático daria
 * a mesa dessa pessoa para outra sem ninguém ter olhado — o tipo de decisão
 * que o salão toma com os olhos, não com um temporizador.
 */
export const PRAZO_DA_CHAMADA_EM_SEGUNDOS = 5 * 60;

/**
 * - `prazo`: conta o que falta de `PRAZO_DA_CHAMADA_EM_SEGUNDOS`, e passa a
 *   contar o atraso depois disso.
 * - `ocupada`, `livre`, `espera`: contam para frente, desde o instante dado.
 */
export type ModoDeRelogio = "prazo" | "ocupada" | "livre" | "espera";

/** Marca o elemento para que o tique cuide do texto dele daqui em diante. */
export function marcarRelogio(no: HTMLElement, modo: ModoDeRelogio, desde: string): HTMLElement {
    no.dataset["relogio"] = modo;
    no.dataset["desde"] = desde;
    return no;
}

function atualizarPrazo(no: HTMLElement, segundos: number): void {
    const restam = PRAZO_DA_CHAMADA_EM_SEGUNDOS - segundos;
    no.textContent = restam >= 0 ? contagem(restam) : `atrasado ${contagem(-restam)}`;

    const mesa = no.closest(".mesa");
    if (mesa === null) {
        return;
    }
    mesa.classList.toggle("mesa--atrasada", restam < 0);

    const barra = mesa.querySelector<HTMLElement>(".mesa__barra");
    if (barra !== null) {
        const fracao = Math.min(1, Math.max(0, restam / PRAZO_DA_CHAMADA_EM_SEGUNDOS));
        barra.style.width = `${(fracao * 100).toFixed(1)}%`;
    }
}

/** Reescreve todos os relógios de uma subárvore. Barato: só mexe em texto. */
export function atualizarRelogios(raiz: ParentNode, agora: Date = new Date()): void {
    for (const no of raiz.querySelectorAll<HTMLElement>("[data-relogio]")) {
        const desde = no.dataset["desde"];
        if (desde === undefined) {
            continue;
        }
        const segundos = segundosDesde(desde, agora);

        switch (no.dataset["relogio"]) {
            case "prazo":
                atualizarPrazo(no, segundos);
                break;
            case "ocupada":
                no.textContent = `na mesa há ${duracao(segundos)}`;
                break;
            case "livre":
                no.textContent = `livre há ${duracao(segundos)}`;
                break;
            case "espera":
                no.textContent = `${duracao(segundos)} esperando`;
                break;
            default:
                break;
        }
    }
}
