export const STATUS_MESA = Object.freeze ({
    DISPONIVEL: "DISPONIVEL",
    RESERVADA: "RESERVADA",
    OCUPADA: "OCUPADA"
})

export class Mesa {
    #id;
    #numero;
    #capacidade;
    #status;

    constructor(id, numero, capacidade){
        this.#id = id
        this.#numero = numero
        this.#capacidade = capacidade
        this.#status = STATUS_MESA.DISPONIVEL
    }

    get id(){
        return this.#id
    }
    get numero(){
        return this.#numero
    }
    get capacidade(){
        return this.#capacidade
    }
    get status(){
        return this.#status
    }

    podeAcomodar(tamanhoGrupo){
        return tamanhoGrupo <= this.#capacidade
    }

    reservar(tamanhoGrupo){
        if (this.#status !== STATUS_MESA.DISPONIVEL){
            throw new Error("Mesa não está mais disponivel para reserva.");
        }
        if (!this.podeAcomodar(tamanhoGrupo)){
            throw new Error("Capacidade da mesa insuficiente para o grupo");
        }this.#status = STATUS_MESA.RESERVADA
    }

    ocupar(){
        if (this.#status === STATUS_MESA.OCUPADA){
            throw new Error("Mesa já está ocupada.");
        }this.#status = STATUS_MESA.OCUPADA
    }

    liberarMesa(){
        this.#status = STATUS_MESA.DISPONIVEL
    }
}