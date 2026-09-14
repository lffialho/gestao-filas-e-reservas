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
 * O instante da meia-noite daquela data, no fuso do salão.
 *
 * Duas passadas de propósito: a primeira chuta o deslocamento, a segunda
 * confere pelo resultado. O Brasil não tem mais horário de verão, mas o dia em
 * que voltar, a virada continua certa.
 */
function meiaNoiteEm(ano: number, mes: number, dia: number): Date {
    const comoUtc = Date.UTC(ano, mes - 1, dia);
    const primeira = new Date(comoUtc - deslocamentoEmMinutos(new Date(comoUtc)) * 60_000);
    return new Date(comoUtc - deslocamentoEmMinutos(primeira) * 60_000);
}

/** O instante em que começou o dia daquele instante, no fuso do salão. */
export function inicioDoDia(instante: Date = new Date()): Date {
    const { ano, mes, dia } = partesEm(instante);
    return meiaNoiteEm(ano, mes, dia);
}

/**
 * O começo do dia de uma data escrita "AAAA-MM-DD" — o formato que o
 * `<input type="date">` entrega — lida no fuso do salão.
 *
 * Passar essa string direto para `new Date()` a leria como meia-noite **UTC**,
 * que em São Paulo é 21h do dia anterior: o fechamento de um dia sairia com as
 * três últimas horas da véspera e sem as três últimas dele mesmo.
 *
 * Devolve `null` para o que não é data: quem chama decide o que dizer. Data que
 * não existe — "2026-02-31" — também é `null`, e não 1º de março: `Date.UTC`
 * rola o mês em silêncio, e relatório de dia inexistente é pedido errado, não
 * pedido a corrigir sozinho.
 */
export function inicioDoDiaDe(data: string): Date | null {
    const casamento = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(data.trim());
    if (casamento === null) {
        return null;
    }

    const [ano, mes, dia] = casamento.slice(1).map(Number);
    if (ano === undefined || mes === undefined || dia === undefined) {
        return null;
    }

    const meiaNoite = meiaNoiteEm(ano, mes, dia);
    const conferencia = partesEm(meiaNoite);
    if (conferencia.ano !== ano || conferencia.mes !== mes || conferencia.dia !== dia) {
        return null;
    }
    return meiaNoite;
}

/** Começo do dia seguinte: o fim aberto do período de hoje. */
export function fimDoDia(instante: Date = new Date()): Date {
    const comeco = inicioDoDia(instante);
    // 26h à frente cai com folga no dia seguinte mesmo com virada de fuso.
    return inicioDoDia(new Date(comeco.getTime() + 26 * 60 * 60_000));
}

/** O fim aberto do dia de uma data "AAAA-MM-DD". */
export function fimDoDiaDe(data: string): Date | null {
    const comeco = inicioDoDiaDe(data);
    return comeco === null ? null : fimDoDia(comeco);
}

/** "2026-09-14" daquele instante, no fuso do salão — o que o seletor de data lê. */
export function dataDoSeletor(instante: Date = new Date()): string {
    const { ano, mes, dia } = partesEm(instante);
    return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
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
