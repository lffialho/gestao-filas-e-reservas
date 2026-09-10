import { Mesa } from "./dominio/entidades/mesa.js";
import { MotorGerente } from "./dominio/servicos/motor-gerente.js";
import { Cliente } from "./dominio/entidades/cliente.js";

const motor = new MotorGerente();

motor.adicionarMesa(new Mesa("m1", 2, 4));
motor.adicionarMesa(new Mesa("m2", 1, 2));

const esperar = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

async function solicitarReserva(
    mesaId: string,
    cliente: Cliente | string,
    tamanhoGrupo: number,
    telefone?: string
): Promise<void> {
    const nomeExibicao = typeof cliente === "string" ? cliente : cliente.nome;

    try {
        await motor.fazerReserva(mesaId, cliente, tamanhoGrupo);
        console.log(`[SUCESSO] Mesa ${mesaId} reservada para ${nomeExibicao}.`);
    } catch (erro) {
        const mensagemErro = erro instanceof Error ? erro.message : String(erro);
        console.log(`[FALHA] Não foi possível reservar a Mesa ${mesaId} para ${nomeExibicao}: ${mensagemErro}`);
        
        if (telefone) {
            motor.entrarNaFila(cliente, tamanhoGrupo, telefone);
            console.log(`[FILA] ${nomeExibicao} entrou na fila de espera.`);
        }
    }
}

async function rodarTesteCompleto(): Promise<void> {
    console.log("==================================================");
    console.log(" INICIANDO TESTES DO BACKEND");
    console.log("==================================================\n");

    console.log("--- Reservas Diretas ---");
    await solicitarReserva("m1", "Ana", 2, "1111-1111");
    await solicitarReserva("m2", "Ana Laura", 2, "3333-3333");

    console.log("\n--- Teste de Ocupação e Fila de Espera ---");
    await solicitarReserva("m1", "Fernando", 2, "2222-2222");

    console.log("\n--- Tempo Decorrido ---");
    console.log("Aguardando 2 segundos para contabilizar tempo de espera..");
    await esperar(2000);

    console.log("\n--- Liberação de Mesa ---");
    await motor.liberaMesa("m1");
    console.log("[MESA LIBERADA] Mesa m1 foi desocupada.");

    // Exemplo utilizando uma instância da entidade Cliente diretamente
    const clienteAna = new Cliente("Ana", 2);
    await solicitarReserva("m1", clienteAna, clienteAna.quantidadePessoas, "1111-1111");

    console.log("\n==================================================");
    console.log("------------------ RELATÓRIO ---------------------");
    console.log("==================================================");

    console.log(motor.gerarRelatorio);
}

rodarTesteCompleto();