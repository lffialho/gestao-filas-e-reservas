import { Cliente } from "./cliente.js";

export interface ItemFila {
    cliente: Cliente | string;
    telefone: string;
    tamanhoGrupo: number;
    dataEntrada: Date;
    dataAtendimento?: Date;
}

export class FilaDeEspera {
    #clientes: ItemFila[];
    #historicoAtendimentos: number[];

    constructor() {
        this.#clientes = [];
        this.#historicoAtendimentos = [];
    }

    adicionar(cliente: Cliente | string, tamanhoGrupo: number, telefone: string): ItemFila {
        const novoCadastro: ItemFila = {
            cliente,
            telefone,
            tamanhoGrupo,
            dataEntrada: new Date()
        };
        this.#clientes.push(novoCadastro);
        return novoCadastro;
    }

    remover(telefone: string): ItemFila | null {
        const index = this.#clientes.findIndex((item) => item.telefone === telefone);

        if (index !== -1) {
            const [clienteRemovido] = this.#clientes.splice(index, 1);
            return clienteRemovido;
        } else {
            return null;
        }
    }

    proximo(): ItemFila | undefined {
        return this.#clientes.shift();
    }

    proximoCompativel(capacidadeDaMesa: number): ItemFila | null {
        const index = this.#clientes.findIndex((item) => item.tamanhoGrupo <= capacidadeDaMesa);

        if (index !== -1) {
            const [clienteRemovido] = this.#clientes.splice(index, 1);

            clienteRemovido.dataAtendimento = new Date();

            const tempoEsperaEmSegundos = Math.floor(
                (clienteRemovido.dataAtendimento.getTime() - clienteRemovido.dataEntrada.getTime()) / 1000
            );

            this.#historicoAtendimentos.push(tempoEsperaEmSegundos);

            return clienteRemovido;
        } else {
            return null;
        }
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