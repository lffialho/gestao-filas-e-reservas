/**
 * Serializa tarefas por chave: duas chamadas com a mesma chave nunca rodam ao
 * mesmo tempo, chaves distintas correm em paralelo.
 *
 * Quem usa mais de uma chave numa só operação deve adquiri-las sempre na mesma
 * ordem — no domínio, primeiro a mesa e depois a fila — para não haver impasse.
 */
export class TravaAssincrona {
    #bloqueios: Map<string, Promise<void>>;

    constructor() {
        this.#bloqueios = new Map();
    }

    async executarComExclusividade<T>(chave: string, tarefa: () => Promise<T> | T): Promise<T> {
        const bloqueioAtual = this.#bloqueios.get(chave) ?? Promise.resolve();

        let liberarProximo!: () => void;
        const proximoBloqueio = new Promise<void>((resolve) => {
            liberarProximo = resolve;
        });

        // `cadeia` é o que fica no Map — e é com ela que a limpeza compara.
        const cadeia = bloqueioAtual.then(() => proximoBloqueio);
        this.#bloqueios.set(chave, cadeia);

        try {
            await bloqueioAtual;
            return await tarefa();
        } finally {
            liberarProximo();
            // Se ninguém entrou na fila atrás desta chave, o Map não guarda lixo.
            if (this.#bloqueios.get(chave) === cadeia) {
                this.#bloqueios.delete(chave);
            }
        }
    }

    /** Quantas chaves têm trava ativa. Usado em teste para garantir que o Map não cresce. */
    get chavesAtivas(): number {
        return this.#bloqueios.size;
    }
}
