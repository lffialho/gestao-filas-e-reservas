import { TravaAssincrona } from "../../compartilhado/assincrono/trava-assincrona.js";
import { Mesa, StatusMesa } from "../entidades/mesa.js";
import { FilaDeEspera, ItemFila } from "../entidades/fila-de-espera.js";
import { Cliente } from "../entidades/cliente.js";

export interface RelatorioGerente {
    taxaOcupacao: string;
    tempoMedio: number;
    tamanhoFila: number;
    mesas: Array<{
        numero: number;
        status: StatusMesa;
    }>;
}

export interface ResultadoReserva {
    sucesso: boolean;
    cliente: Cliente | string;
    mesaNumero: number;
    status: StatusMesa;
}

export interface ResultadoLiberacao {
    sucesso: boolean;
    mesaNumero: number;
    atendido?: Cliente | string;
    status?: StatusMesa;
    mensagem?: string;
}

export class MotorGerente {
    #mesas: Map<string, Mesa>;
    #trava: TravaAssincrona;
    #filaDeEspera: FilaDeEspera;

    constructor() {
        this.#mesas = new Map<string, Mesa>();
        this.#trava = new TravaAssincrona();
        this.#filaDeEspera = new FilaDeEspera();
    }

    adicionarMesa(mesa: Mesa): Map<string, Mesa> {
        return this.#mesas.set(mesa.id, mesa);
    }

    buscarMesa(id: string): Mesa | undefined {
        return this.#mesas.get(id);
    }

    entrarNaFila(cliente: Cliente | string, tamanhoGrupo: number, telefone: string): ItemFila {
        return this.#filaDeEspera.adicionar(cliente, tamanhoGrupo, telefone);
    }

    get tamanhoFilaEspera(): number {
        return this.#filaDeEspera.tamanhoDaFila;
    }

    get tempoMedioEspera(): number {
        return this.#filaDeEspera.tempoMedioDeEsperaEmSegundos;
    }

    get taxaDeOcupacao(): number {
        if (this.#mesas.size === 0) {
            return 0;
        }
        const listaDeMesas = Array.from(this.#mesas.values());
        const ocupadas = listaDeMesas.filter((mesa) => mesa.status === StatusMesa.RESERVADA).length;

        return Math.round((ocupadas / this.#mesas.size) * 100);
    }

    get gerarRelatorio(): RelatorioGerente {
        return {
            taxaOcupacao: `${this.taxaDeOcupacao}%`,
            tempoMedio: this.tempoMedioEspera,
            tamanhoFila: this.#filaDeEspera.tamanhoDaFila,
            mesas: Array.from(this.#mesas.values()).map((mesa) => ({
                numero: mesa.numero,
                status: mesa.status
            }))
        };
    }

    async fazerReserva(mesaId: string, cliente: Cliente | string, tamanhoGrupo: number): Promise<ResultadoReserva> {
        const mesa = this.buscarMesa(mesaId);
        if (!mesa) {
            throw new Error("Mesa não encontrada.");
        }
        return await this.#trava.executarComExclusividade(mesaId, async () => {
            mesa.reservar(tamanhoGrupo);
            return {
                sucesso: true,
                cliente,
                mesaNumero: mesa.numero,
                status: mesa.status
            };
        });
    }

    async liberaMesa(mesaId: string): Promise<ResultadoLiberacao> {
        return await this.#trava.executarComExclusividade(mesaId, async () => {
            const mesa = this.buscarMesa(mesaId);

            if (!mesa) {
                throw new Error("Mesa não encontrada.");
            }

            mesa.liberarMesa();

            const proximoCliente = this.#filaDeEspera.proximoCompativel(mesa.capacidade);

            if (proximoCliente !== null) {
                mesa.reservar(proximoCliente.tamanhoGrupo);
                return {
                    sucesso: true,
                    mesaNumero: mesa.numero,
                    atendido: proximoCliente.cliente,
                    status: mesa.status
                };
            } else {
                return {
                    sucesso: true,
                    mesaNumero: mesa.numero,
                    mensagem: "Mesa Liberada e sem clientes na fila!"
                };
            }
        });
    }

    async cancelarReserva(telefone: string): Promise<ItemFila | null> {
        return await this.#trava.executarComExclusividade("fila", async () => {
            const clienteRemovido = this.#filaDeEspera.remover(telefone);
            return clienteRemovido;
        });
    }
}