export class Cliente {
    #nome: string;
    #quantidadePessoas: number;
    #horaChegada: Date;

    constructor(nome: string, quantidadePessoas: number = 1) {
        this.#nome = nome;
        this.#quantidadePessoas = quantidadePessoas;
        this.#horaChegada = new Date();
    }

    get nome(): string {
        return this.#nome;
    }

    get quantidadePessoas(): number {
        return this.#quantidadePessoas;
    }

    get horaChegada(): Date {
        return this.#horaChegada;
    }
}