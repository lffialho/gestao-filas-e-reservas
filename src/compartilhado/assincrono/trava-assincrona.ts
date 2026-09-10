export class TravaAssincrona {
    #bloqueios: Map<string, Promise<void>>;

    constructor() {
        this.#bloqueios = new Map();
    }

    async executarComExclusividade<T>(
        chave: string,
        tarefa: () => Promise<T> | T
    ): Promise<T> {
        const bloqueioAtual = this.#bloqueios.get(chave) || Promise.resolve();

        let liberarProximo!: () => void;
        const proximoBloqueio = new Promise<void>((resolve) => {
            liberarProximo = resolve;
        });

        this.#bloqueios.set(
            chave,
            bloqueioAtual.then(() => proximoBloqueio)
        );

        try {
            await bloqueioAtual;
            return await tarefa();
        } finally {
            liberarProximo();
            if (this.#bloqueios.get(chave) === proximoBloqueio) {
                this.#bloqueios.delete(chave);
            }
        }
    }
}