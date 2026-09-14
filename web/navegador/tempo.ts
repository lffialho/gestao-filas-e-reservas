/**
 * Tempo no fuso do restaurante.
 *
 * O fuso mora aqui, e não no serviço, por uma razão prática: o serviço trabalha
 * com instantes, e instante não tem fuso. "Hoje" tem — e quem sabe onde começa
 * o dia é quem opera o salão, não o processo que guarda o estado. Fixar aqui
 * também é mais correto do que usar o fuso do aparelho: o tablet do balcão pode
 * estar configurado de qualquer jeito, e o relatório do dia não pode depender
 * disso.
 */
export const FUSO = "America/Sao_Paulo";

const PARTES = new Intl.DateTimeFormat("en-US", {
    timeZone: FUSO,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
});

interface DataLocal {
    ano: number;
    mes: number;
    dia: number;
    hora: number;
    minuto: number;
    segundo: number;
}

function partesEm(instante: Date): DataLocal {
    const encontradas = new Map<string, string>();
    for (const parte of PARTES.formatToParts(instante)) {
        encontradas.set(parte.type, parte.value);
    }
    const numero = (tipo: string): number => Number(encontradas.get(tipo) ?? "0");
    return {
        ano: numero("year"),
        mes: numero("month"),
        dia: numero("day"),
        hora: numero("hour"),
        minuto: numero("minute"),
        segundo: numero("second")
    };
}

/** Quanto o fuso está adiantado em relação ao UTC, em minutos, naquele instante. */
function deslocamentoEmMinutos(instante: Date): number {
    const local = partesEm(instante);
    const comoSeFosseUtc = Date.UTC(
        local.ano,
        local.mes - 1,
        local.dia,
        local.hora,
        local.minuto,
        local.segundo
    );
    return (comoSeFosseUtc - instante.getTime()) / 60_000;
}

/**
 * O instante em que começou o dia daquele instante, no fuso do salão.
 *
 * Duas passadas de propósito: a primeira chuta o deslocamento pelo próprio
 * instante recebido, a segunda confere pelo resultado. O Brasil não tem mais
 * horário de verão, mas o dia em que voltar, a virada continua certa.
 */
export function inicioDoDia(instante: Date = new Date()): Date {
    const { ano, mes, dia } = partesEm(instante);
    const meiaNoiteComoUtc = Date.UTC(ano, mes - 1, dia);

    let palpite = new Date(meiaNoiteComoUtc - deslocamentoEmMinutos(instante) * 60_000);
    palpite = new Date(meiaNoiteComoUtc - deslocamentoEmMinutos(palpite) * 60_000);
    return palpite;
}

/** Começo do dia seguinte: o fim aberto do período de hoje. */
export function fimDoDia(instante: Date = new Date()): Date {
    const comeco = inicioDoDia(instante);
    // 26h à frente cai com folga no dia seguinte mesmo com virada de fuso.
    return inicioDoDia(new Date(comeco.getTime() + 26 * 60 * 60_000));
}

/** "20:12" no fuso do salão. */
export function horaMinuto(instante: Date): string {
    const { hora, minuto } = partesEm(instante);
    return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
}

/** "sábado, 13 de setembro" no fuso do salão. */
export function dataPorExtenso(instante: Date = new Date()): string {
    return new Intl.DateTimeFormat("pt-BR", {
        timeZone: FUSO,
        weekday: "long",
        day: "numeric",
        month: "long"
    }).format(instante);
}

/**
 * Duração curta e legível: "8 min", "1h12", "47 s". Sempre sem casas — quem
 * opera o salão lê de relance, não confere com cronômetro.
 */
export function duracao(segundos: number): string {
    const inteiros = Math.max(0, Math.floor(segundos));
    if (inteiros < 60) {
        return `${inteiros} s`;
    }
    const minutos = Math.floor(inteiros / 60);
    if (minutos < 60) {
        return `${minutos} min`;
    }
    return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`;
}

/** Relógio de contagem: "1:04". Para o prazo de quem foi chamado. */
export function contagem(segundos: number): string {
    const inteiros = Math.max(0, Math.floor(segundos));
    return `${Math.floor(inteiros / 60)}:${String(inteiros % 60).padStart(2, "0")}`;
}

/** Quantos segundos se passaram desde um instante ISO. */
export function segundosDesde(iso: string, agora: Date = new Date()): number {
    return Math.max(0, Math.floor((agora.getTime() - new Date(iso).getTime()) / 1000));
}
