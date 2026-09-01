export class FilaDeEspera{
    #clientes
    #historicoAtendimentos
    constructor(){
        this.#clientes = []
    }
    
    adicionar(cliente, tamanhoGrupo, telefone){
        const novoCadastro = {
            cliente: cliente,
            telefone: telefone,
            tamanhoGrupo: tamanhoGrupo,
            dataEntrada: new Date()
        }
        this.#clientes.push(novoCadastro)
        return novoCadastro
    }

    remover(telefone){
        const index = this.#clientes.findIndex((cliente) => cliente.telefone === telefone)

        if (index !== -1){
            const clienteRemovido = this.#clientes.splice(index, 1)[0]
            return clienteRemovido
        }else{
            return null
        }
    }

    proximo(){
        return this.#clientes.shift()
    }

    proximoCompativel(capacidadeDaMesa){
        const index = this.#clientes.findIndex((cliente) => cliente.tamanhoGrupo <= capacidadeDaMesa)
        
        if (index !== -1){
            const clienteRemovido = this.#clientes.splice(index, 1)[0]

            clienteRemovido.dataAtendimento = new Date()

            const tempoEsperaEmSegundos = Math.floor(clienteRemovido.dataAtendimento - clienteRemovido.dataEntrada) / 1000

            this.#historicoAtendimentos.push(tempoEsperaEmSegundos)

            return clienteRemovido
        }else{
            return null
        }
    }

    get tempoMedioDeEsperaEmSegundos(){
        if(this.#historicoAtendimentos.length === 0){
            return 0
        }
        const soma = this.#historicoAtendimentos.reduce((total, tempo) => total + tempo, 0)
        return Math.round(soma / this.#historicoAtendimentos.length)
    }

    get tamanhoDaFila(){
        return this.#clientes.length
    }

    estaVazia(){
        return this.#clientes.length === 0
    }

}