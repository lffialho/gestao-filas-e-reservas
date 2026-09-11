import { type StatusMesa } from "./entidades/mesa.js";

/**
 * Retrato completo e serializável do salão — o contrato entre o domínio e
 * quem o persiste.
 *
 * É diferente de `InfoMesa` e `RelatorioDoSalao`, que são modelos de leitura
 * para apresentação: aqui nada pode faltar, porque é daqui que o salão é
 * reconstruído depois de um reinício. Datas vão como ISO 8601 para atravessar
 * JSON e SQL sem perder informação.
 */
export interface EstadoDoCliente {
    nome: string;
    quantidadePessoas: number;
    telefone: string;
    horaChegada: string;
}

export interface EstadoDaMesa {
    id: string;
    numero: number;
    capacidade: number;
    status: StatusMesa;
    /** Obrigatório quando a mesa não está disponível, proibido quando está. */
    cliente: EstadoDoCliente | null;
}

export interface EstadoDoItemFila {
    cliente: EstadoDoCliente;
    dataEntrada: string;
    dataAtendimento: string | null;
}

export interface EstadoDaFila {
    itens: EstadoDoItemFila[];
    /** Esperas já contabilizadas, em segundos — a base do tempo médio. */
    esperasEmSegundos: number[];
}

export interface EstadoDoSalao {
    mesas: EstadoDaMesa[];
    fila: EstadoDaFila;
}
