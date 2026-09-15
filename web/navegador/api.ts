/**
 * Cliente da API do salão.
 *
 * Os tipos abaixo espelham o que a API devolve. São declarados aqui, e não
 * importados de `src/`, de propósito: o contrato entre o painel e o serviço é
 * o formato que viaja no fio, não um tipo compartilhado. É o que deixa esta
 * pasta poder sumir sem o backend perceber.
 *
 * Tudo vai para `/api/...`, que é o servidor do painel — ele põe o token. O
 * navegador nunca vê `SALAO_TOKEN`.
 */

export type StatusMesa = "DISPONIVEL" | "RESERVADA" | "OCUPADA";

export interface Posicao {
    coluna: number;
    linha: number;
}

export interface InfoCliente {
    nome: string;
    telefone: string;
    quantidadePessoas: number;
}

export interface InfoMesa {
    id: string;
    numero: number;
    capacidade: number;
    status: StatusMesa;
    cliente: InfoCliente | null;
    posicao: Posicao | null;
    /** ISO 8601 — desde quando a mesa está neste status. */
    desde: string;
}

export interface RelatorioDoSalao {
    taxaOcupacaoPercentual: number;
    tempoMedioEsperaSegundos: number;
    tamanhoFila: number;
    mesas: InfoMesa[];
}

export interface ClienteJson {
    nome: string;
    telefone: string;
    quantidadePessoas: number;
    horaChegada: string;
}

export interface ItemFilaJson {
    cliente: ClienteJson;
    dataEntrada: string;
    dataAtendimento: string | null;
}

/**
 * Mesa que vagou. `atendido` é quem saiu da fila e ficou com ela — `null` se
 * ninguém na fila cabia. É o campo que deixa o painel dizer para quem a mesa
 * acabou de ser chamada, em vez de mandar o maître conferir na tela.
 */
export interface LiberacaoJson {
    mesaId: string;
    mesaNumero: number;
    status: StatusMesa;
    clienteAnterior: ClienteJson;
    atendido: ClienteJson | null;
}

export interface ResumoPorMesa {
    mesaId: string;
    mesaNumero: number;
    capacidade: number;
    giros: number;
    permanenciaMediaSegundos: number;
    aproveitamentoPercentual: number;
}

export interface ResumoDoPeriodo {
    gruposAtendidos: number;
    pessoasAtendidas: number;
    esperaMediaSegundos: number;
    maiorEsperaSegundos: number;
    picoDaFila: number;
    desistencias: number;
    reservasCanceladas: number;
    porMesa: ResumoPorMesa[];
}

export type TipoDeEvento =
    | "mesa_cadastrada"
    | "mesa_removida"
    | "sentou_direto"
    | "entrou_na_fila"
    | "saiu_da_fila"
    | "chamado"
    | "ocupou"
    | "liberou"
    | "reserva_cancelada";

export interface EventoDoSalao {
    momento: string;
    tipo: TipoDeEvento;
    mesaId: string | null;
    mesaNumero: number | null;
    capacidade: number | null;
    telefone: string | null;
    nome: string | null;
    pessoas: number | null;
    esperaEmSegundos: number | null;
    permanenciaEmSegundos: number | null;
}

export interface PaginaDeEventos {
    itens: EventoDoSalao[];
    /** Quantos houve no período inteiro, independente do corte pedido. */
    total: number;
}

/**
 * O que aconteceria se este grupo chegasse agora. Vem do próprio salão, e não
 * de uma cópia da regra aqui na tela: `mesa` diz onde sentaria — ou, numa
 * recusa por telefone repetido, onde esse telefone já está.
 */
export interface Previsao {
    destino: "mesa" | "fila" | "recusa";
    mesa: InfoMesa | null;
    posicao: number | null;
    /** Em "recusa", o mesmo `tipo` do erro que a chegada de verdade daria. */
    motivo: string | null;
}

export type Recepcao =
    | { destino: "mesa"; mesa: InfoMesa }
    | { destino: "fila"; posicao: number; item: ItemFilaJson };

/**
 * Erro que a API devolveu, com o `tipo` preservado. O painel decide pelo tipo,
 * como manda o README do serviço — a mensagem é para mostrar, não para casar.
 */
export class ErroDaApi extends Error {
    readonly status: number;
    readonly tipo: string;
    readonly campos: Record<string, unknown>;

    constructor(status: number, tipo: string, mensagem: string, campos: Record<string, unknown>) {
        super(mensagem);
        this.name = "ErroDaApi";
        this.status = status;
        this.tipo = tipo;
        this.campos = campos;
    }
}

interface CorpoDeErro {
    erro?: { tipo?: string; mensagem?: string; [campo: string]: unknown };
}

async function pedir<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
    let resposta: Response;
    try {
        resposta = await fetch(`/api${caminho}`, {
            ...opcoes,
            headers: opcoes.body === undefined ? {} : { "Content-Type": "application/json" }
        });
    } catch {
        throw new ErroDaApi(0, "SemResposta", "Não foi possível falar com o painel.", {});
    }

    // Sessão vencida: a tela não tem o que fazer com este erro além de mandar
    // a pessoa entrar de novo. Tratar aqui, num lugar só, evita que cada tela
    // tenha de lembrar disso — e o painel recarrega sozinho quatro vezes a cada
    // três segundos, então o erro apareceria em toda parte ao mesmo tempo.
    if (resposta.status === 401) {
        window.location.assign("/entrar");
        throw new ErroDaApi(401, "PainelNaoAutenticado", "Entre no painel de novo.", {});
    }

    const texto = await resposta.text();
    const corpo: unknown = texto === "" ? null : JSON.parse(texto);

    if (!resposta.ok) {
        const erro = (corpo as CorpoDeErro | null)?.erro;
        const { tipo, mensagem, ...campos } = erro ?? {};
        throw new ErroDaApi(
            resposta.status,
            tipo ?? "ErroDesconhecido",
            mensagem ?? `O serviço respondeu ${resposta.status}.`,
            campos
        );
    }

    return corpo as T;
}

export const api = {
    salao: (): Promise<RelatorioDoSalao> => pedir("/salao"),

    fila: (): Promise<{ itens: ItemFilaJson[] }> => pedir("/fila"),

    relatorio: (de: Date, ate: Date): Promise<ResumoDoPeriodo> => {
        const busca = new URLSearchParams({ de: de.toISOString(), ate: ate.toISOString() });
        return pedir(`/relatorio?${busca.toString()}`);
    },

    eventos: (de: Date, ate: Date, limite: number): Promise<PaginaDeEventos> => {
        const busca = new URLSearchParams({
            de: de.toISOString(),
            ate: ate.toISOString(),
            limite: String(limite)
        });
        return pedir(`/eventos?${busca.toString()}`);
    },

    previa: (pessoas: number, telefone: string): Promise<Previsao> => {
        const busca = new URLSearchParams({ pessoas: String(pessoas) });
        if (telefone !== "") {
            busca.set("telefone", telefone);
        }
        return pedir(`/chegadas/previa?${busca.toString()}`);
    },

    chegada: (nome: string, pessoas: number, telefone: string): Promise<Recepcao> =>
        pedir("/chegadas", { method: "POST", body: JSON.stringify({ nome, pessoas, telefone }) }),

    ocupar: (mesaId: string): Promise<InfoMesa> =>
        pedir(`/mesas/${encodeURIComponent(mesaId)}/ocupacao`, { method: "POST" }),

    liberar: (mesaId: string): Promise<LiberacaoJson> =>
        pedir(`/mesas/${encodeURIComponent(mesaId)}/liberacao`, { method: "POST" }),

    cancelarReserva: (mesaId: string): Promise<LiberacaoJson> =>
        pedir(`/mesas/${encodeURIComponent(mesaId)}/reserva`, { method: "DELETE" }),

    sairDaFila: (telefone: string): Promise<unknown> =>
        pedir(`/fila/${encodeURIComponent(telefone)}`, { method: "DELETE" }),

    moverMesa: (mesaId: string, posicao: Posicao): Promise<InfoMesa> =>
        pedir(`/mesas/${encodeURIComponent(mesaId)}/posicao`, {
            method: "POST",
            body: JSON.stringify(posicao)
        }),

    cadastrarMesa: (id: string, numero: number, capacidade: number): Promise<InfoMesa> =>
        pedir("/mesas", { method: "POST", body: JSON.stringify({ id, numero, capacidade }) }),

    removerMesa: (mesaId: string): Promise<InfoMesa> =>
        pedir(`/mesas/${encodeURIComponent(mesaId)}`, { method: "DELETE" })
};
