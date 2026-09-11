import { type Relogio, relogioDoSistema } from "../../compartilhado/tempo/relogio.js";
import { type EstadoDoCliente } from "../estado.js";
import { DadosInvalidos } from "../erros.js";

/**
 * O telefone é a identidade do cliente: é por ele que se remove da fila e se
 * avisa que a mesa está pronta. `quantidadePessoas` é a única fonte de verdade
 * do tamanho do grupo — nenhuma operação recebe esse número por fora.
 */
export class Cliente {
    #nome: string;
    #quantidadePessoas: number;
    #telefone: string;
    #horaChegada: Date;

    constructor(
        nome: string,
        quantidadePessoas: number,
        telefone: string,
        relogio: Relogio = relogioDoSistema
    ) {
        if (nome.trim() === "") {
            throw new DadosInvalidos("O nome do cliente não pode ser vazio.");
        }
        if (!Number.isInteger(quantidadePessoas) || quantidadePessoas < 1) {
            throw new DadosInvalidos(
                `Quantidade de pessoas inválida: ${quantidadePessoas}. Informe um inteiro maior que zero.`
            );
        }
        if (telefone.trim() === "") {
            throw new DadosInvalidos("O telefone do cliente não pode ser vazio.");
        }

        this.#nome = nome.trim();
        this.#quantidadePessoas = quantidadePessoas;
        this.#telefone = telefone.trim();
        this.#horaChegada = relogio.agora();
    }

    get nome(): string {
        return this.#nome;
    }

    get quantidadePessoas(): number {
        return this.#quantidadePessoas;
    }

    get telefone(): string {
        return this.#telefone;
    }

    get horaChegada(): Date {
        return new Date(this.#horaChegada);
    }

    /**
     * Recria um cliente já existente a partir do estado gravado. Diferente do
     * construtor, que marca a hora de chegada como agora: aqui a chegada é a
     * que foi salva, senão todo reinício zeraria o tempo de espera de quem
     * está na fila.
     */
    static reconstituir(estado: EstadoDoCliente): Cliente {
        const cliente = new Cliente(estado.nome, estado.quantidadePessoas, estado.telefone);
        const chegada = new Date(estado.horaChegada);

        if (Number.isNaN(chegada.getTime())) {
            throw new DadosInvalidos(`Hora de chegada inválida para "${estado.nome}": ${estado.horaChegada}.`);
        }
        cliente.#horaChegada = chegada;
        return cliente;
    }

    estado(): EstadoDoCliente {
        return {
            nome: this.#nome,
            quantidadePessoas: this.#quantidadePessoas,
            telefone: this.#telefone,
            horaChegada: this.#horaChegada.toISOString()
        };
    }
}
