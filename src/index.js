import { Mesa } from "./dominio/entidades/mesa.js";
import { MotorGerente } from "./dominio/servicos/motor-gerente.js";
import { Cliente } from "./dominio/entidades/cliente.js";

const motor = new MotorGerente()

motor.adicionarMesa(new Mesa("m1",2, 4))
motor.adicionarMesa(new Mesa("m2",1, 2))

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function solicitarReserva(mesaId, cliente, tamanhoGrupo, telefone) {
    try{
        const reservaFeita = await motor.fazerReserva(mesaId, cliente, tamanhoGrupo, telefone)
        console.log(`[SUCESSO] Mesa ${mesaId} reservada para ${cliente}.`)
    }catch(erro){
            console.log(`[FALHA] Não foi possível reservar a Mesa ${mesaId} para ${cliente}: ${erro.message}`)        
            if (telefone){
            motor.entrarNaFila(cliente, tamanhoGrupo, telefone)
            console.log(`[FILA] ${cliente} entrou na fila de espera.`)
        }
    }
}

async function rodarTesteCompleto() {
    console.log("==================================================");
    console.log(" INICIANDO TESTES DO BACKEND");
    console.log("==================================================\n");

    console.log("--- Reservas Diretas ---");
    await solicitarReserva("m1", "Ana", 2, "1111-1111");
    await solicitarReserva("m2", "Ana Laura", 2, "3333-3333");

    console.log("\n--- Teste de Ocupação e Fila de Espera ---");
    // Fernando tenta reservar a Mesa m1 (já ocupada) -> Redirecionado para a fila
    await solicitarReserva("m1", "Fernando", 2, "2222-2222");

    console.log("\n--- Tempo Decorrido ---");
    console.log("Aguardando 2 segundos para contabilizar tempo de espera..");
    await esperar(2000);

    console.log("\n--- Liberação de Mesa ---");
    await motor.liberaMesa("m1");
    console.log("[MESA LIBERADA] Mesa m1 foi desocupada.");

    // Método para atender o próximo da fila
    const cliente1 = new Cliente("Ana", 2);
    await solicitarReserva("m1", "Ana", 2, "1111-1111")

    console.log("\n==================================================");
    console.log("------------------ RELATÓRIO ---------------------");
    console.log("==================================================");

    // Executa o método de relatório
    const relatorio = typeof motor.gerarRelatorio === "function" 
        ? motor.gerarRelatorio() 
        : motor.gerarRelatorio;

    console.log(relatorio);
}

rodarTesteCompleto();

