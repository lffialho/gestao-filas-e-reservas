export class FilaDeEspera{
    #clientes
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

    proximo(){
        return this.#clientes.shift()
    }

    proximoCompativel(capacidadeDaMesa){
        const index = this.#clientes.findIndex((cliente) => cliente.tamanhoGrupo <= capacidadeDaMesa)
        
        if (index !== -1){
            const clienteRemovido = this.#clientes.splice(index, 1)[0]
            return clienteRemovido
        }else{
            return null
        }
    }

    get tamanhoDaFila(){
        return this.#clientes.length
    }

    estaVazia(){
        return this.#clientes.length === 0
    }
}