export class TravaAssincrona {
    constructor(){
        this.bloqueios = new Map()
    }

    async executarComExclusividade(chave, tarefa){
        const bloqueioAtual = this.bloqueios.get(chave) || Promise.resolve()
        let liberarProximo
        const proximoBloqueio = new Promise((resolve) => liberarProximo = resolve)
        this.bloqueios.set(chave, bloqueioAtual.then(() => proximoBloqueio))

        try{
            await bloqueioAtual
            return await tarefa()
        }finally{
            liberarProximo()
            if (this.bloqueios.get(chave) === proximoBloqueio) {
                this.bloqueios.delete(chave)
            }
        }
    }
}