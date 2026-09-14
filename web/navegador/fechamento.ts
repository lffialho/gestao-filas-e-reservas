import type { ResumoDoPeriodo } from "./api.js";
import { el } from "./dom.js";
import { duracao } from "./tempo.js";

/**
 * O fechamento do dia, do jeito mais simples que já é útil: os números que o
 * serviço somou a partir do diário, do começo do dia até agora.
 *
 * Sai do diário, e não do estado do salão, e é por isso que ele sobrevive a um
 * reinício do serviço no meio do expediente — o estado diz como o salão está, e
 * só o diário sabe como ele chegou aqui.
 */

interface Numero {
    rotulo: string;
    valor: string;
    nota?: string;
}

function linhaDe({ rotulo, valor, nota }: Numero): HTMLElement {
    return el(
        "div",
        { classe: "fechamento__linha" },
        el("span", { classe: "fechamento__rotulo", texto: rotulo }),
        el("span", { classe: "fechamento__valor mono", texto: valor }),
        nota === undefined ? false : el("span", { classe: "fechamento__nota", texto: nota })
    );
}

function tabelaDeMesas(resumo: ResumoDoPeriodo): HTMLElement {
    if (resumo.porMesa.length === 0) {
        return el("p", { classe: "fechamento__vazio", texto: "Nenhuma mesa girou ainda hoje." });
    }

    const tabela = el(
        "table",
        { classe: "fechamento__mesas" },
        el(
            "thead",
            {},
            el(
                "tr",
                {},
                el("th", { texto: "Mesa" }),
                el("th", { texto: "Giros" }),
                el("th", { texto: "Permanência média" }),
                el("th", { texto: "Aproveitamento" })
            )
        )
    );

    const corpo = el("tbody");
    for (const mesa of resumo.porMesa) {
        corpo.append(
            el(
                "tr",
                {},
                el("td", { texto: `${mesa.mesaNumero} · ${mesa.capacidade} lug.` }),
                el("td", { classe: "mono", texto: String(mesa.giros) }),
                el("td", { classe: "mono", texto: duracao(mesa.permanenciaMediaSegundos) }),
                el("td", { classe: "mono", texto: `${mesa.aproveitamentoPercentual}%` })
            )
        );
    }

    tabela.append(corpo);
    return tabela;
}

export function desenharFechamento(resumo: ResumoDoPeriodo): HTMLElement {
    const numeros: Numero[] = [
        { rotulo: "Grupos atendidos", valor: String(resumo.gruposAtendidos) },
        { rotulo: "Pessoas atendidas", valor: String(resumo.pessoasAtendidas) },
        {
            rotulo: "Espera média",
            valor: duracao(resumo.esperaMediaSegundos),
            nota: "de quem passou pela fila"
        },
        { rotulo: "Maior espera", valor: duracao(resumo.maiorEsperaSegundos) },
        { rotulo: "Pico da fila", valor: `${resumo.picoDaFila} grupos` },
        { rotulo: "Desistências", valor: String(resumo.desistencias) },
        {
            rotulo: "Mesas devolvidas",
            valor: String(resumo.reservasCanceladas),
            nota: "chamadas que não viraram ocupação"
        }
    ];

    return el(
        "div",
        { classe: "fechamento" },
        el("div", { classe: "fechamento__numeros" }, ...numeros.map(linhaDe)),
        tabelaDeMesas(resumo)
    );
}
