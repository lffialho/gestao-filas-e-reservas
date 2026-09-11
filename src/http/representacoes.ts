import type { Cliente } from "../dominio/entidades/cliente.js";
import type { ItemFila } from "../dominio/entidades/fila-de-espera.js";
import type {
    InfoMesa,
    RelatorioDoSalao,
    ResultadoLiberacao,
    ResultadoRecepcao,
    ResultadoReserva
} from "../dominio/entidades/salao.js";

/**
 * Como o domínio aparece no corpo das respostas.
 *
 * É uma camada à parte do `EstadoDoSalao` usado para persistir: o que a API
 * expõe pode mudar sem mexer no banco, e vice-versa. Entidades têm campos
 * privados e não serializam sozinhas — `JSON.stringify(cliente)` daria `{}`.
 */
export interface ClienteJson {
    nome: string;
    telefone: string;
    quantidadePessoas: number;
    horaChegada: string;
}

export function clienteJson(cliente: Cliente): ClienteJson {
    return {
        nome: cliente.nome,
        telefone: cliente.telefone,
        quantidadePessoas: cliente.quantidadePessoas,
        horaChegada: cliente.horaChegada.toISOString()
    };
}

export interface ItemFilaJson {
    cliente: ClienteJson;
    dataEntrada: string;
    dataAtendimento: string | null;
}

export function itemFilaJson(item: ItemFila): ItemFilaJson {
    return {
        cliente: clienteJson(item.cliente),
        dataEntrada: item.dataEntrada.toISOString(),
        dataAtendimento: item.dataAtendimento?.toISOString() ?? null
    };
}

/** `InfoMesa` e `RelatorioDoSalao` já são dados simples: passam direto. */
export function mesaJson(mesa: InfoMesa): InfoMesa {
    return mesa;
}

export function relatorioJson(relatorio: RelatorioDoSalao): RelatorioDoSalao {
    return relatorio;
}

export type RecepcaoJson =
    | { destino: "mesa"; mesa: InfoMesa }
    | { destino: "fila"; posicao: number; item: ItemFilaJson };

export function recepcaoJson(resultado: ResultadoRecepcao): RecepcaoJson {
    if (resultado.destino === "mesa") {
        return { destino: "mesa", mesa: resultado.mesa };
    }
    return { destino: "fila", posicao: resultado.posicao, item: itemFilaJson(resultado.item) };
}

export interface ReservaJson {
    mesaId: string;
    mesaNumero: number;
    status: string;
    cliente: ClienteJson;
}

export function reservaJson(resultado: ResultadoReserva): ReservaJson {
    return {
        mesaId: resultado.mesaId,
        mesaNumero: resultado.mesaNumero,
        status: resultado.status,
        cliente: clienteJson(resultado.cliente)
    };
}

export interface LiberacaoJson {
    mesaId: string;
    mesaNumero: number;
    status: string;
    clienteAnterior: ClienteJson;
    atendido: ClienteJson | null;
}

export function liberacaoJson(resultado: ResultadoLiberacao): LiberacaoJson {
    return {
        mesaId: resultado.mesaId,
        mesaNumero: resultado.mesaNumero,
        status: resultado.status,
        clienteAnterior: clienteJson(resultado.clienteAnterior),
        atendido: resultado.atendido === null ? null : clienteJson(resultado.atendido)
    };
}
