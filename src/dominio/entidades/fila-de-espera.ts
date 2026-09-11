import { Cliente } from "./cliente.js";
import { type Relogio, relogioDoSistema } from "../../compartilhado/tempo/relogio.js";
import { ClienteJaNaFila, ItemForaDaFila } from "../erros.js";

export interface ItemFila {
    cliente: Cliente;
    dataEntrada: Date;
    dataAtendimento?: Date;
}

export class FilaDeEspera {
    #clientes: ItemFila[];
    #historicoAtendimentos: number[];
    #relogio: Relogio;

    constructor(relogio: Relogio = relogioDoSistema) {
        this.#clientes = [];
        this.#historicoAtendimentos = [];
        this.#relogio = relogio;
    }

    adicionar(cliente: Cliente): ItemFila {
        if (this.#clientes.some((item) => item.cliente.telefone === cliente.telefone)) {
            throw new ClienteJaNaFila(cliente.telefone);
        }

        const novoCadastro: ItemFila = {
            cliente,
            dataEntrada: this.#relogio.agora()
        };
        this.#clientes.push(novoCadastro);
        return novoCadastro;
    }

    remover(telefone: string): ItemFila | null {
        const index = this.#clientes.findIndex((item) => item.cliente.telefone === telefone);

        if (index === -1) {
            return null;
        }
        const [clienteRemovido] = this.#clientes.splice(index, 1);
        return clienteRemovido ?? null;
    }

    /**
     * Espia o primeiro da fila que cabe na mesa, SEM removê-lo. Quem chama
     * confirma com `confirmarAtendimento` só depois de a mesa aceitar a
     * reserva — assim uma falha no meio não some com o cliente.
     */
    proximoCompativel(capacidadeDaMesa: number): ItemFila | null {
        return this.#clientes.find((item) => item.cliente.quantidadePessoas <= capacidadeDaMesa) ?? null;
    }

    /** Tira o item da fila e contabiliza quanto ele esperou. */
    confirmarAtendimento(item: ItemFila): void {
        const index = this.#clientes.indexOf(item);
        if (index === -1) {
            throw new ItemForaDaFila();
        }
        this.#clientes.splice(index, 1);

        const atendimento = this.#relogio.agora();
        item.dataAtendimento = atendimento;
        this.#historicoAtendimentos.push(
            Math.floor((atendimento.getTime() - item.dataEntrada.getTime()) / 1000)
        );
    }

    get tempoMedioDeEsperaEmSegundos(): number {
        if (this.#historicoAtendimentos.length === 0) {
            return 0;
        }
        const soma = this.#historicoAtendimentos.reduce((total, tempo) => total + tempo, 0);
        return Math.round(soma / this.#historicoAtendimentos.length);
    }

    get tamanhoDaFila(): number {
        return this.#clientes.length;
    }

    estaVazia(): boolean {
        return this.#clientes.length === 0;
    }
}
