import { Mesa } from "./dominio/entidades/mesa.js";
import { Cliente } from "./dominio/entidades/cliente.js";
import { MotorGerente } from "./dominio/servicos/motor-gerente.js";
import { ErroDeDominio } from "./dominio/erros.js";

const motor = new MotorGerente();

motor.adicionarMesa(new Mesa("m1", 1, 4));
motor.adicionarMesa(new Mesa("m2", 2, 2));
motor.adicionarMesa(new Mesa("m3", 3, 2));

const esperar = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, ms));

const titulo = (texto: string): void => {
    console.log(`\n--- ${texto} ---`);
};

/**
 * Tenta reservar. Se a mesa não servir, o cliente entra na fila de espera —
 * e o motivo da recusa vem do tipo do erro, não de comparar texto.
 */
async function solicitarReserva(mesaId: string, cliente: Cliente): Promise<void> {
    try {
        const reserva = await motor.fazerReserva(mesaId, cliente);
        console.log(`[RESERVA] Mesa ${reserva.mesaNumero} reservada para ${cliente.nome} (${cliente.quantidadePessoas} pessoas).`);
    } catch (erro) {
        if (!(erro instanceof ErroDeDominio)) {
            throw erro;
        }
        console.log(`[RECUSADA] ${erro.name}: ${erro.message}`);

        const item = await motor.entrarNaFila(cliente);
        console.log(`[FILA] ${item.cliente.nome} entrou na fila — posição ${motor.tamanhoFilaEspera}.`);
    }
}

function relatarLiberacao(rotulo: string, mesaNumero: number, anterior: string, atendido: string | null): void {
    console.log(`[${rotulo}] Mesa ${mesaNumero} liberada por ${anterior}.`);
    if (atendido === null) {
        console.log("          Ninguém na fila cabia nesta mesa — segue disponível.");
    } else {
        console.log(`          ${atendido} saiu da fila e ficou com a mesa.`);
    }
}

async function demonstrar(): Promise<void> {
    console.log("=".repeat(56));
    console.log(" GESTÃO DE FILAS E RESERVAS — demonstração");
    console.log("=".repeat(56));

    titulo("Reservas diretas");
    await solicitarReserva("m1", new Cliente("Ana", 2, "1111-1111"));
    await solicitarReserva("m2", new Cliente("Ana Laura", 2, "3333-3333"));

    titulo("Mesa cheia manda para a fila");
    await solicitarReserva("m1", new Cliente("Fernando", 2, "2222-2222"));

    titulo("O grupo da m2 chegou e sentou");
    console.log(`          Taxa de ocupação antes de ocupar: ${motor.taxaDeOcupacao}%`);
    const m2 = await motor.ocuparMesa("m2");
    console.log(`[OCUPADA] Mesa ${m2.numero} agora está ${m2.status} com ${m2.cliente?.nome}.`);
    console.log(`          Taxa de ocupação depois: ${motor.taxaDeOcupacao}% — ocupada conta igual a reservada.`);

    titulo("Tempo na fila");
    console.log("Aguardando 2 segundos para contabilizar a espera do Fernando...");
    await esperar(2000);

    titulo("A mesa m1 vira");
    const liberacao = await motor.liberarMesa("m1");
    relatarLiberacao(
        "LIBERADA",
        liberacao.mesaNumero,
        liberacao.clienteAnterior.nome,
        liberacao.atendido?.nome ?? null
    );

    titulo("Cancelamento de reserva");
    await solicitarReserva("m3", new Cliente("Helena", 2, "4444-4444"));
    const cancelamento = await motor.cancelarReserva("m3");
    relatarLiberacao(
        "CANCELADA",
        cancelamento.mesaNumero,
        cancelamento.clienteAnterior.nome,
        cancelamento.atendido?.nome ?? null
    );
    console.log(`          Status da m3 depois do cancelamento: ${motor.consultarMesa("m3")?.status}.`);

    titulo("Cancelar o que não existe é recusado");
    try {
        await motor.cancelarReserva("m3");
        throw new Error("A demonstração esperava uma recusa que não aconteceu.");
    } catch (erro) {
        if (!(erro instanceof ErroDeDominio)) {
            throw erro;
        }
        console.log(`[RECUSADA] ${erro.name}: ${erro.message}`);
    }

    titulo("Relatório");
    const relatorio = motor.gerarRelatorio();
    console.log(`Taxa de ocupação ..... ${relatorio.taxaOcupacaoPercentual}%`);
    console.log(`Tempo médio de espera  ${relatorio.tempoMedioEsperaSegundos}s`);
    console.log(`Clientes na fila ..... ${relatorio.tamanhoFila}`);
    for (const mesa of relatorio.mesas) {
        const ocupante = mesa.cliente === null ? "—" : mesa.cliente.nome;
        console.log(`  Mesa ${mesa.numero} (${mesa.capacidade} lug.) ${mesa.status.padEnd(11)} ${ocupante}`);
    }
}

demonstrar().catch((erro: unknown) => {
    console.error("A demonstração falhou:", erro);
    process.exitCode = 1;
});
