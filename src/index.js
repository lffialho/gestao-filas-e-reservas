import { Mesa } from "./dominio/entidades/mesa.js";
import { MotorGerente } from "./dominio/servicos/motor-gerente.js";

const motor = new MotorGerente()
const mesa1 = new Mesa ("m1", 1, 4)
const mesa2 = new Mesa ("m2", 2, 2)

motor.adicionarMesa(mesa1)
motor.adicionarMesa(mesa2)

async function solicitarReserva(mesaId, cliente, tamanhoGrupo, telefone) {
    try{
        const reservaFeita = await motor.fazerReserva(mesaId, cliente, tamanhoGrupo, telefone)
        console.log(`[sucesso]`, reservaFeita )
    }catch(erro){
        console.log(`[falha]`, erro.message)
        if (telefone){
            motor.entrarNaFila(cliente, tamanhoGrupo, telefone)
            console.log(`[fila]`, motor.tamanhoFilaEspera)
        }
    }
}

async function rodarTeste() {
    await solicitarReserva("m2", "Ana", 2, "3848")
    await solicitarReserva("m2", "Bruno", 2, "3848")
    await solicitarReserva("m2", "Carlos", 5, "3848")
    const res = await motor.liberaMesa("m2")
    console.log(res)
    console.log(motor.tamanhoFilaEspera)
}

rodarTeste()


