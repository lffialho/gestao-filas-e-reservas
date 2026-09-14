import type { StatusMesa } from "./entidades/mesa.js";
import type { Posicao } from "./entidades/planta.js";

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
    /** Ladrilho da planta. `null` só antes de o salão colocar a mesa. */
    posicao: Posicao | null;
    /**
     * Desde quando a mesa está neste status, em ISO 8601. É daqui que saem o
     * prazo de quem foi chamado e há quanto tempo o grupo está na mesa — sem
     * isso o status diz o quê, mas nunca desde quando.
     */
    desde: string;
}

export interface EstadoDoItemFila {
    cliente: EstadoDoCliente;
    dataEntrada: string;
    dataAtendimento: string | null;
}

/**
 * Esperas já contabilizadas, agregadas. Guardar a soma e a contagem em vez da
 * lista inteira mantém o retrato do salão do mesmo tamanho depois de dez ou de
 * dez mil atendimentos — o relatório só precisa da média.
 */
export interface EstadoDasEsperas {
    somaEmSegundos: number;
    atendimentos: number;
}

export interface EstadoDaFila {
    itens: EstadoDoItemFila[];
    esperas: EstadoDasEsperas;
}

export interface EstadoDoSalao {
    mesas: EstadoDaMesa[];
    fila: EstadoDaFila;
}
