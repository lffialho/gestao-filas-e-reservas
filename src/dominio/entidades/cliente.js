export class Cliente {
    #nome
    #quantidadePessoas
    #horaChegada

    constructor(nome, quantidadePessoas = 1) {
        this.#nome = nome
        this.#quantidadePessoas = quantidadePessoas
        this.#horaChegada = new Date()
    }

    get nome() {
        return this.#nome
    }

    get quantidadePessoas() {
        return this.#quantidadePessoas
    }

    get horaChegada() {
        return this.#horaChegada
    }
}