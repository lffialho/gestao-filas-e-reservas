export enum StatusMesa {
    DISPONIVEL = "DISPONIVEL",
    RESERVADA = "RESERVADA",
    OCUPADA = "OCUPADA"
}

export class Mesa {
    #id: string;
    #numero: number;
    #capacidade: number;
    #status: StatusMesa;

    constructor(id: string, numero: number, capacidade: number) {
        this.#id = id;
        this.#numero = numero;
        this.#capacidade = capacidade;
        this.#status = StatusMesa.DISPONIVEL;
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

    podeAcomodar(tamanhoGrupo: number): boolean {
        return tamanhoGrupo <= this.#capacidade;
    }

    reservar(tamanhoGrupo: number): void {
        if (this.#status !== StatusMesa.DISPONIVEL) {
            throw new Error("Mesa não está mais disponivel para reserva.");
        }
        if (!this.podeAcomodar(tamanhoGrupo)) {
            throw new Error("Capacidade da mesa insuficiente para o grupo");
        }
        this.#status = StatusMesa.RESERVADA;
    }

    ocupar(): void {
        if (this.#status === StatusMesa.OCUPADA) {
            throw new Error("Mesa já está ocupada.");
        }
        this.#status = StatusMesa.OCUPADA;
    }

    liberarMesa(): void {
        this.#status = StatusMesa.DISPONIVEL;
    }
}