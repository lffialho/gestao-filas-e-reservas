import { TravaAssincrona } from "../../compartilhado/assincrono/trava-assincrona.js";
import { Mesa } from "../entidades/mesa.js";
import { FilaDeEspera } from "../entidades/fila-de-espera.js";

export class MotorGerente {
    #mesas;
    #trava;
    #filaDeEspera

    constructor(){
        this.#mesas = new Map()
        this.#trava = new TravaAssincrona()
        this.#filaDeEspera = new FilaDeEspera()
    }

    adicionarMesa(mesa){
        return this.#mesas.set(mesa.id, mesa)
    }

    buscarMesa(id){
        return this.#mesas.get(id)
    }

    entrarNaFila(cliente, tamanhoGrupo, telefone){
        return this.#filaDeEspera.adicionar(cliente,tamanhoGrupo,telefone)
    }

    get tamanhoFilaEspera(){
        return this.#filaDeEspera.tamanhoDaFila
    }

    get tempoMedioEspera(){
        return this.#filaDeEspera.tempoMedioDeEsperaEmSegundos
    }

    get taxaDeOcupacao(){
        if (this.#mesas.size === 0){
            return 0
        }
        const listaDeMesas = Array.from(this.#mesas.values())
        const ocupadas = listaDeMesas.filter((mesa) => mesa.status === 'RESERVADA').length

        return Math.round((ocupadas / this.#mesas.size) * 100)
    }

    async fazerReserva(mesaId, cliente, tamanhoGrupo){
        const mesa = this.buscarMesa(mesaId)
        if (!mesa){
            throw new Error("Mesa não encontrada.");
        }
        return await this.#trava.executarComExclusividade(mesaId, async() =>  {
            mesa.reservar(tamanhoGrupo)
            return {
                sucesso: true,
                cliente,
                mesaNumero: mesa.numero,
                status: mesa.status
            }
        })
    }

    async liberaMesa(mesaId){
        return await this.#trava.executarComExclusividade(mesaId, async() => {
            const mesa = this.buscarMesa(mesaId)

        if (!mesa){
            throw new Error("Mesa não encontrada.");
        }

        mesa.liberarMesa()

        const proximoCliente = this.#filaDeEspera.proximoCompativel(mesa.capacidade)
            
        if (proximoCliente !== null){
                mesa.reservar(proximoCliente.tamanhoGrupo)
            return {
                sucesso: true,
                mesaNumero: mesa.numero,
                atendido: proximoCliente.cliente,
                status: mesa.status
            }
        }else{
            return{
                sucesso: true,
                mesaNumero: mesa.numero,
                mensagem: "Mesa Liberada e sem clientes na fila!"
            }
        }})
    }
    
    async cancelarReserva(telefone){
        return await this.#trava.executarComExclusividade("fila", async() => {
            const clienteRemovido = this.#filaDeEspera.remover(telefone)
            return clienteRemovido
        })
    }
}


