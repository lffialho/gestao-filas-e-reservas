import type { EventoDoSalao } from "../eventos.js";

/**
 * O que aconteceu com uma mesa no período. Um "giro" é um atendimento que
 * terminou: o grupo sentou e foi embora. Reserva cancelada não conta como
 * giro — a mesa ficou parada, que é o oposto de girar.
 */
export interface ResumoPorMesa {
    mesaId: string;
    mesaNumero: number;
    capacidade: number;
    giros: number;
    permanenciaMediaSegundos: number;
    /** Média de pessoas sobre capacidade, em pontos percentuais. */
    aproveitamentoPercentual: number;
}

export interface ResumoDoPeriodo {
    gruposAtendidos: number;
    pessoasAtendidas: number;
    /**
     * Média de espera de quem **passou pela fila**. Quem chegou e sentou
     * direto não entra: incluir um monte de zeros faria o número dizer o
     * quanto o salão estava vazio, não quanto se espera quando há espera.
     */
    esperaMediaSegundos: number;
    maiorEsperaSegundos: number;
    /**
     * Maior fila observada, contando a partir de zero no começo do período.
     * Quem já esperava antes dele não entra na conta — o diário não sabe o
     * tamanho da fila antes do primeiro evento que recebeu.
     */
    picoDaFila: number;
    desistencias: number;
    reservasCanceladas: number;
    porMesa: ResumoPorMesa[];
}

interface Acumulador {
    mesaId: string;
    mesaNumero: number;
    capacidade: number;
    giros: number;
    somaPermanencia: number;
    somaAproveitamento: number;
}

const media = (soma: number, quantidade: number): number =>
    quantidade === 0 ? 0 : Math.round(soma / quantidade);

/**
 * Transforma o diário em números. Fica no domínio, e não no adaptador, porque
 * é regra de leitura do negócio: testar "o pico da fila foi 3" não pode exigir
 * um banco.
 */
export function resumirPeriodo(eventos: readonly EventoDoSalao[]): ResumoDoPeriodo {
    const emOrdem = [...eventos].sort((a, b) => a.momento.localeCompare(b.momento));

    let gruposAtendidos = 0;
    let pessoasAtendidas = 0;
    let somaEspera = 0;
    let quantasEsperas = 0;
    let maiorEsperaSegundos = 0;
    let desistencias = 0;
    let reservasCanceladas = 0;
    let naFila = 0;
    let picoDaFila = 0;

    const mesas = new Map<string, Acumulador>();

    for (const evento of emOrdem) {
        if (evento.tipo === "sentou_direto" || evento.tipo === "chamado") {
            gruposAtendidos += 1;
            pessoasAtendidas += evento.pessoas ?? 0;
        }

        if (evento.tipo === "chamado") {
            const espera = evento.esperaEmSegundos ?? 0;
            somaEspera += espera;
            quantasEsperas += 1;
            maiorEsperaSegundos = Math.max(maiorEsperaSegundos, espera);
            naFila = Math.max(0, naFila - 1);
        }

        if (evento.tipo === "entrou_na_fila") {
            naFila += 1;
            picoDaFila = Math.max(picoDaFila, naFila);
        }

        if (evento.tipo === "saiu_da_fila") {
            desistencias += 1;
            naFila = Math.max(0, naFila - 1);
        }

        if (evento.tipo === "reserva_cancelada") {
            reservasCanceladas += 1;
        }

        if (evento.tipo === "liberou" && evento.mesaId !== null) {
            const capacidade = evento.capacidade ?? 0;
            const anterior = mesas.get(evento.mesaId) ?? {
                mesaId: evento.mesaId,
                mesaNumero: evento.mesaNumero ?? 0,
                capacidade,
                giros: 0,
                somaPermanencia: 0,
                somaAproveitamento: 0
            };
            anterior.giros += 1;
            anterior.somaPermanencia += evento.permanenciaEmSegundos ?? 0;
            anterior.somaAproveitamento +=
                capacidade === 0 ? 0 : ((evento.pessoas ?? 0) / capacidade) * 100;
            anterior.capacidade = capacidade;
            anterior.mesaNumero = evento.mesaNumero ?? anterior.mesaNumero;
            mesas.set(evento.mesaId, anterior);
        }
    }

    const porMesa = Array.from(mesas.values())
        .map((acumulado) => ({
            mesaId: acumulado.mesaId,
            mesaNumero: acumulado.mesaNumero,
            capacidade: acumulado.capacidade,
            giros: acumulado.giros,
            permanenciaMediaSegundos: media(acumulado.somaPermanencia, acumulado.giros),
            aproveitamentoPercentual: media(acumulado.somaAproveitamento, acumulado.giros)
        }))
        .sort((a, b) => a.mesaNumero - b.mesaNumero);

    return {
        gruposAtendidos,
        pessoasAtendidas,
        esperaMediaSegundos: media(somaEspera, quantasEsperas),
        maiorEsperaSegundos,
        picoDaFila,
        desistencias,
        reservasCanceladas,
        porMesa
    };
}
