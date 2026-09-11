import { TravaAssincrona } from "../../compartilhado/assincrono/trava-assincrona.js";
import { type Relogio, relogioDoSistema } from "../../compartilhado/tempo/relogio.js";
import { Mesa, StatusMesa } from "../entidades/mesa.js";
import { FilaDeEspera, type ItemFila } from "../entidades/fila-de-espera.js";
import { Cliente } from "../entidades/cliente.js";
import {
    CancelamentoInvalido,
    FilaTemPrioridade,
    GrupoSemMesaPossivel,
    MesaDuplicada,
    MesaNaoEncontrada
} from "../erros.js";

/**
 * Uma decisão de alocação lê todas as mesas e a fila ao mesmo tempo, então o
 * recurso a travar é o salão inteiro — não uma mesa. Chave única também
 * significa que não há travas aninhadas e, portanto, nenhuma ordem a respeitar.
 */
const CHAVE_SALAO = "salao";

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

export interface RelatorioGerente {
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

export class MotorGerente {
    #mesas: Map<string, Mesa>;
    #trava: TravaAssincrona;
    #filaDeEspera: FilaDeEspera;

    constructor(relogio: Relogio = relogioDoSistema) {
        this.#mesas = new Map<string, Mesa>();
        this.#trava = new TravaAssincrona();
        this.#filaDeEspera = new FilaDeEspera(relogio);
    }

    /** Não devolve nada: o Map interno não sai daqui. */
    adicionarMesa(mesa: Mesa): void {
        if (this.#mesas.has(mesa.id)) {
            throw new MesaDuplicada(mesa.id);
        }
        this.#mesas.set(mesa.id, mesa);
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

    get tamanhoFilaEspera(): number {
        return this.#filaDeEspera.tamanhoDaFila;
    }

    get tempoMedioEspera(): number {
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

    gerarRelatorio(): RelatorioGerente {
        return {
            taxaOcupacaoPercentual: this.taxaDeOcupacao,
            tempoMedioEsperaSegundos: this.tempoMedioEspera,
            tamanhoFila: this.tamanhoFilaEspera,
            mesas: Array.from(this.#mesas.values()).map(retratar)
        };
    }

    /**
     * Porta de entrada do salão: senta o cliente na melhor mesa livre ou o
     * coloca na fila. É aqui que a ordem de chegada é garantida — use este
     * método em vez de escolher a mesa na mão.
     */
    async receberCliente(cliente: Cliente): Promise<ResultadoRecepcao> {
        return this.#trava.executarComExclusividade(CHAVE_SALAO, () => {
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
        });
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
    async fazerReserva(mesaId: string, cliente: Cliente): Promise<ResultadoReserva> {
        return this.#trava.executarComExclusividade(CHAVE_SALAO, () => {
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
        });
    }

    /** O grupo que reservou chegou e sentou. */
    async ocuparMesa(mesaId: string): Promise<InfoMesa> {
        return this.#trava.executarComExclusividade(CHAVE_SALAO, () => {
            const mesa = this.#obterMesa(mesaId);
            mesa.ocupar();
            return retratar(mesa);
        });
    }

    async entrarNaFila(cliente: Cliente): Promise<ItemFila> {
        return this.#trava.executarComExclusividade(CHAVE_SALAO, () =>
            this.#filaDeEspera.adicionar(cliente)
        );
    }

    /** Desistência: sai da fila de espera. Não mexe em mesa nenhuma. */
    async sairDaFila(telefone: string): Promise<ItemFila | null> {
        return this.#trava.executarComExclusividade(CHAVE_SALAO, () =>
            this.#filaDeEspera.remover(telefone)
        );
    }

    /** O grupo foi embora: a mesa vira e o próximo da fila que couber assume. */
    async liberarMesa(mesaId: string): Promise<ResultadoLiberacao> {
        return this.#desocupar(mesaId, null);
    }

    /** A reserva não vem mais: a mesa vira e o próximo da fila que couber assume. */
    async cancelarReserva(mesaId: string): Promise<ResultadoLiberacao> {
        return this.#desocupar(mesaId, (mesa) => {
            if (mesa.status !== StatusMesa.RESERVADA) {
                throw new CancelamentoInvalido(mesa.id, mesa.status);
            }
        });
    }

    #desocupar(mesaId: string, validar: ((mesa: Mesa) => void) | null): Promise<ResultadoLiberacao> {
        return this.#trava.executarComExclusividade(CHAVE_SALAO, () => {
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
        });
    }
}
