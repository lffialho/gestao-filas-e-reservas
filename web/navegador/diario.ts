import type { EventoDoSalao } from "./api.js";
import { el } from "./dom.js";
import { duracao, horaMinuto } from "./tempo.js";

/**
 * O diário do dia em linhas.
 *
 * Traduz fato em frase e nada mais. Os nomes dos eventos são neutros no
 * domínio de propósito — `reserva_cancelada` é o fato, "não apareceu" seria
 * palpite — e essa neutralidade é mantida aqui: a linha diz que a mesa voltou
 * para a fila, não por que voltou.
 */

/** A que a linha chama atenção. Só isso decide a cor. */
type Tom = "neutro" | "chamada" | "ocupacao" | "apagado";

interface Linha {
    tom: Tom;
    texto: string;
}

function descrever(evento: EventoDoSalao): Linha {
    const mesa = evento.mesaNumero === null ? "a mesa" : `mesa ${evento.mesaNumero}`;
    const Mesa = mesa.charAt(0).toUpperCase() + mesa.slice(1);
    const quem = evento.nome ?? "alguém";

    switch (evento.tipo) {
        case "mesa_cadastrada":
            return { tom: "apagado", texto: `${Mesa} entrou na planta · ${evento.capacidade} lugares` };
        case "sentou_direto":
            return { tom: "ocupacao", texto: `${quem} sentou direto na ${mesa}` };
        case "entrou_na_fila":
            return { tom: "neutro", texto: `${quem} entrou na fila · ${evento.pessoas} pessoas` };
        case "saiu_da_fila":
            return { tom: "apagado", texto: `${quem} saiu da fila` };
        case "chamado":
            return {
                tom: "chamada",
                texto: `${Mesa} chamada · ${quem} esperou ${duracao(evento.esperaEmSegundos ?? 0)}`
            };
        case "ocupou":
            return { tom: "ocupacao", texto: `${Mesa} ocupada · ${quem}` };
        case "liberou":
            return {
                tom: "neutro",
                texto: `${Mesa} vagou · ${quem} ficou ${duracao(evento.permanenciaEmSegundos ?? 0)}`
            };
        case "reserva_cancelada":
            return { tom: "chamada", texto: `${Mesa} voltou para a fila · ${quem} não sentou` };
        default:
            return { tom: "apagado", texto: "" };
    }
}

export function desenharDiario(eventos: readonly EventoDoSalao[]): HTMLElement[] {
    if (eventos.length === 0) {
        return [el("p", { classe: "diario__vazio", texto: "Nada aconteceu ainda hoje." })];
    }

    return eventos.map((evento) => {
        const { tom, texto } = descrever(evento);
        return el(
            "div",
            { classe: "diario__linha" },
            el("span", { classe: "diario__hora mono", texto: horaMinuto(new Date(evento.momento)) }),
            el("span", { classe: `diario__texto diario__texto--${tom}`, texto })
        );
    });
}
