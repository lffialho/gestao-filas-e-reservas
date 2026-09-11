import { Cliente } from "./cliente.js";
import {
    CapacidadeInsuficiente,
    DadosInvalidos,
    MesaIndisponivel,
    MesaJaDisponivel,
    TransicaoInvalida
} from "../erros.js";

export enum StatusMesa {
    DISPONIVEL = "DISPONIVEL",
    RESERVADA = "RESERVADA",
    OCUPADA = "OCUPADA"
}

/**
 * Ciclo de vida: DISPONIVEL → RESERVADA → OCUPADA → DISPONIVEL.
 * Uma mesa que não está DISPONIVEL sempre tem um cliente associado.
 */
export class Mesa {
    #id: string;
    #numero: number;
    #capacidade: number;
    #status: StatusMesa;
    #clienteAtual: Cliente | null;

    constructor(id: string, numero: number, capacidade: number) {
        if (id.trim() === "") {
            throw new DadosInvalidos("O id da mesa não pode ser vazio.");
        }
        if (!Number.isInteger(numero) || numero < 1) {
            throw new DadosInvalidos(`Número de mesa inválido: ${numero}. Informe um inteiro maior que zero.`);
        }
        if (!Number.isInteger(capacidade) || capacidade < 1) {
            throw new DadosInvalidos(`Capacidade inválida para a mesa "${id}": ${capacidade}.`);
        }

        this.#id = id.trim();
        this.#numero = numero;
        this.#capacidade = capacidade;
        this.#status = StatusMesa.DISPONIVEL;
        this.#clienteAtual = null;
    }

    get id(): string {
        return this.#id;
    }

    get numero(): number {
        return this.#numero;
    }

    get capacidade(): number {
        return this.#capacidade;
    }

    get status(): StatusMesa {
        return this.#status;
    }

    get clienteAtual(): Cliente | null {
        return this.#clienteAtual;
    }

    get estaDisponivel(): boolean {
        return this.#status === StatusMesa.DISPONIVEL;
    }

    podeAcomodar(tamanhoGrupo: number): boolean {
        return tamanhoGrupo <= this.#capacidade;
    }

    /** O tamanho do grupo vem do próprio cliente — não há segundo número a divergir. */
    reservar(cliente: Cliente): void {
        if (this.#status !== StatusMesa.DISPONIVEL) {
            throw new MesaIndisponivel(this.#id, this.#status);
        }
        if (!this.podeAcomodar(cliente.quantidadePessoas)) {
            throw new CapacidadeInsuficiente(this.#id, this.#capacidade, cliente.quantidadePessoas);
        }
        this.#status = StatusMesa.RESERVADA;
        this.#clienteAtual = cliente;
    }

    /** O grupo que reservou chegou e sentou. */
    ocupar(): void {
        if (this.#status !== StatusMesa.RESERVADA) {
            throw new TransicaoInvalida(this.#id, this.#status, "ocupar");
        }
        this.#status = StatusMesa.OCUPADA;
    }

    /** Devolve quem estava na mesa, para que o chamador possa informar. */
    liberar(): Cliente {
        if (this.#status === StatusMesa.DISPONIVEL) {
            throw new MesaJaDisponivel(this.#id);
        }
        const anterior = this.#clienteAtual;
        if (anterior === null) {
            throw new TransicaoInvalida(this.#id, this.#status, "liberar");
        }
        this.#status = StatusMesa.DISPONIVEL;
        this.#clienteAtual = null;
        return anterior;
    }
}
