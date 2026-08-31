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
    await solicitarReserva("m2", "Ana", 2, "1111")
    await solicitarReserva("m2", "Fernando", 2, "2222")
    await solicitarReserva("m2", "Ana Laura", 2, "3333")
    await solicitarReserva("m2", "Ana Luiza", 2, "4444")
    await solicitarReserva("m2", "Bruno", 2, "5555")
    await solicitarReserva("m2", "Carlos", 5, "6666")
    const reservaCancelada = await motor.cancelarReserva("3333")
    console.log(reservaCancelada)
    console.log(motor.tamanhoFilaEspera)
}

rodarTeste()


