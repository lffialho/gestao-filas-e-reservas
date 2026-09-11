import { type Relogio, relogioDoSistema } from "../../compartilhado/tempo/relogio.js";
import { Cliente } from "./cliente.js";
import { FilaDeEspera, type ItemFila } from "./fila-de-espera.js";
import { Mesa, StatusMesa } from "./mesa.js";
import { type EstadoDoSalao } from "../estado.js";
import {
    CancelamentoInvalido,
    FilaTemPrioridade,
    GrupoSemMesaPossivel,
    MesaDuplicada,
    MesaNaoEncontrada
} from "../erros.js";

/** Retrato imutável de uma mesa, para leitura fora do domínio. */
export interface InfoMesa {
    id: string;
    numero: number;
    capacidade: number;
    status: StatusMesa;
    cliente: InfoCliente | null;
}

export interface InfoCliente {
    nome: string;
    telefone: string;
    quantidadePessoas: number;
}

export interface RelatorioDoSalao {
    /** Número puro. A formatação é responsabilidade de quem apresenta. */
    taxaOcupacaoPercentual: number;
    tempoMedioEsperaSegundos: number;
    tamanhoFila: number;
    mesas: InfoMesa[];
}

export interface ResultadoReserva {
    mesaId: string;
    mesaNumero: number;
    cliente: Cliente;
    status: StatusMesa;
}

/** O cliente foi recebido: ou sentou numa mesa, ou entrou na fila. */
export type ResultadoRecepcao =
    | { destino: "mesa"; mesa: InfoMesa }
    | { destino: "fila"; posicao: number; item: ItemFila };

export interface ResultadoLiberacao {
    mesaId: string;
    mesaNumero: number;
    /** Quem ocupava a mesa até agora. */
    clienteAnterior: Cliente;
    /** Quem saiu da fila e ficou com a mesa, ou `null` se ninguém cabia. */
    atendido: Cliente | null;
    status: StatusMesa;
}

function retratar(mesa: Mesa): InfoMesa {
    const cliente = mesa.clienteAtual;
    return Object.freeze({
        id: mesa.id,
        numero: mesa.numero,
        capacidade: mesa.capacidade,
        status: mesa.status,
        cliente:
            cliente === null
                ? null
                : Object.freeze({
                      nome: cliente.nome,
                      telefone: cliente.telefone,
                      quantidadePessoas: cliente.quantidadePessoas
                  })
    });
}

/**
 * O salão é o agregado: mesas e fila de espera precisam mudar juntas para
 * continuarem coerentes — dar uma mesa a alguém é, no mesmo instante, tirá-lo
 * da fila. Por isso a consistência se define aqui, e não por mesa.
 *
 * Tudo nesta classe é síncrono e sem E/S: quem persiste é o repositório, que
 * executa uma operação destas dentro de uma transação. Isso mantém a lógica de
 * alocação testável sem `await` e sem banco.
 */
export class Salao {
    #mesas: Map<string, Mesa>;
    #filaDeEspera: FilaDeEspera;

    constructor(relogio: Relogio = relogioDoSistema, mesas: readonly Mesa[] = []) {
        this.#mesas = new Map<string, Mesa>();
        this.#filaDeEspera = new FilaDeEspera(relogio);
        for (const mesa of mesas) {
            this.adicionarMesa(mesa);
        }
    }

    adicionarMesa(mesa: Mesa): void {
        if (this.#mesas.has(mesa.id)) {
            throw new MesaDuplicada(mesa.id);
        }
        this.#mesas.set(mesa.id, mesa);
    }

    /** Recria o salão inteiro a partir do estado gravado. */
    static reconstituir(estado: EstadoDoSalao, relogio: Relogio = relogioDoSistema): Salao {
        const salao = new Salao(relogio, estado.mesas.map((mesa) => Mesa.reconstituir(mesa)));
        salao.#filaDeEspera = FilaDeEspera.reconstituir(estado.fila, relogio);
        return salao;
    }

    /** Retrato completo para persistência — ver `EstadoDoSalao`. */
    estado(): EstadoDoSalao {
        return {
            mesas: Array.from(this.#mesas.values()).map((mesa) => mesa.estado()),
            fila: this.#filaDeEspera.estado()
        };
    }

    #obterMesa(mesaId: string): Mesa {
        const mesa = this.#mesas.get(mesaId);
        if (mesa === undefined) {
            throw new MesaNaoEncontrada(mesaId);
        }
        return mesa;
    }

    /** Leitura: devolve um retrato, não a entidade mutável. */
    consultarMesa(mesaId: string): InfoMesa | undefined {
        const mesa = this.#mesas.get(mesaId);
        return mesa === undefined ? undefined : retratar(mesa);
    }

    get totalDeMesas(): number {
        return this.#mesas.size;
    }

    get tamanhoFila(): number {
        return this.#filaDeEspera.tamanhoDaFila;
    }

    get tempoMedioEsperaSegundos(): number {
        return this.#filaDeEspera.tempoMedioDeEsperaEmSegundos;
    }

    get maiorCapacidade(): number {
        let maior = 0;
        for (const mesa of this.#mesas.values()) {
            maior = Math.max(maior, mesa.capacidade);
        }
        return maior;
    }

    /** Reservada e ocupada contam como ocupação — as duas tiram a mesa de circulação. */
    get taxaDeOcupacao(): number {
        if (this.#mesas.size === 0) {
            return 0;
        }
        const indisponiveis = Array.from(this.#mesas.values()).filter((mesa) => !mesa.estaDisponivel).length;

        return Math.round((indisponiveis / this.#mesas.size) * 100);
    }

    relatorio(): RelatorioDoSalao {
        return {
            taxaOcupacaoPercentual: this.taxaDeOcupacao,
            tempoMedioEsperaSegundos: this.tempoMedioEsperaSegundos,
            tamanhoFila: this.tamanhoFila,
            mesas: Array.from(this.#mesas.values()).map(retratar)
        };
    }

    /**
     * Porta de entrada do salão: senta o cliente na melhor mesa livre ou o
     * coloca na fila. É aqui que a ordem de chegada é garantida.
     */
    receberCliente(cliente: Cliente): ResultadoRecepcao {
        const maior = this.maiorCapacidade;
        if (cliente.quantidadePessoas > maior) {
            throw new GrupoSemMesaPossivel(cliente.quantidadePessoas, maior);
        }

        const mesa = this.#melhorMesaLivrePara(cliente);
        if (mesa !== null) {
            mesa.reservar(cliente);
            return { destino: "mesa", mesa: retratar(mesa) };
        }

        const item = this.#filaDeEspera.adicionar(cliente);
        return { destino: "fila", posicao: this.#filaDeEspera.tamanhoDaFila, item };
    }

    /**
     * Melhor mesa livre para o grupo: a menor que o acomode, para não gastar
     * uma mesa grande com um casal. Uma mesa é descartada se alguém que já
     * está na fila também caberia nela — quem chegou antes tem prioridade.
     */
    #melhorMesaLivrePara(cliente: Cliente): Mesa | null {
        const candidatas = Array.from(this.#mesas.values())
            .filter((mesa) => mesa.estaDisponivel && mesa.podeAcomodar(cliente.quantidadePessoas))
            .sort((a, b) => a.capacidade - b.capacidade);

        for (const mesa of candidatas) {
            const esperando = this.#filaDeEspera.proximoCompativel(mesa.capacidade);
            if (esperando === null || esperando.cliente.telefone === cliente.telefone) {
                return mesa;
            }
        }
        return null;
    }

    /**
     * Coloca o cliente numa mesa escolhida a dedo. Continua valendo a ordem de
     * chegada: se alguém na fila cabe nessa mesa, só ele pode recebê-la — e,
     * nesse caso, sai da fila ao sentar.
     */
    fazerReserva(mesaId: string, cliente: Cliente): ResultadoReserva {
        const mesa = this.#obterMesa(mesaId);
        const esperando = this.#filaDeEspera.proximoCompativel(mesa.capacidade);

        if (esperando !== null && esperando.cliente.telefone !== cliente.telefone) {
            throw new FilaTemPrioridade(mesa.id, esperando.cliente.nome);
        }

        mesa.reservar(cliente);
        if (esperando !== null) {
            this.#filaDeEspera.confirmarAtendimento(esperando);
        }

        return {
            mesaId: mesa.id,
            mesaNumero: mesa.numero,
            cliente,
            status: mesa.status
        };
    }

    /** O grupo que reservou chegou e sentou. */
    ocuparMesa(mesaId: string): InfoMesa {
        const mesa = this.#obterMesa(mesaId);
        mesa.ocupar();
        return retratar(mesa);
    }

    entrarNaFila(cliente: Cliente): ItemFila {
        return this.#filaDeEspera.adicionar(cliente);
    }

    /** Desistência: sai da fila de espera. Não mexe em mesa nenhuma. */
    sairDaFila(telefone: string): ItemFila | null {
        return this.#filaDeEspera.remover(telefone);
    }

    /** O grupo foi embora: a mesa vira e o próximo da fila que couber assume. */
    liberarMesa(mesaId: string): ResultadoLiberacao {
        return this.#desocupar(mesaId, null);
    }

    /** A reserva não vem mais: a mesa vira e o próximo da fila que couber assume. */
    cancelarReserva(mesaId: string): ResultadoLiberacao {
        return this.#desocupar(mesaId, (mesa) => {
            if (mesa.status !== StatusMesa.RESERVADA) {
                throw new CancelamentoInvalido(mesa.id, mesa.status);
            }
        });
    }

    #desocupar(mesaId: string, validar: ((mesa: Mesa) => void) | null): ResultadoLiberacao {
        const mesa = this.#obterMesa(mesaId);
        if (validar !== null) {
            validar(mesa);
        }

        const clienteAnterior = mesa.liberar();
        const proximo = this.#filaDeEspera.proximoCompativel(mesa.capacidade);

        if (proximo === null) {
            return {
                mesaId: mesa.id,
                mesaNumero: mesa.numero,
                clienteAnterior,
                atendido: null,
                status: mesa.status
            };
        }

        // A mesa aceita primeiro; só depois o cliente sai da fila.
        mesa.reservar(proximo.cliente);
        this.#filaDeEspera.confirmarAtendimento(proximo);

        return {
            mesaId: mesa.id,
            mesaNumero: mesa.numero,
            clienteAnterior,
            atendido: proximo.cliente,
            status: mesa.status
        };
    }
}
