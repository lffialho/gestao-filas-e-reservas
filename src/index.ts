import { Mesa } from "./dominio/entidades/mesa.js";
import { Cliente } from "./dominio/entidades/cliente.js";
import { MotorGerente } from "./dominio/servicos/motor-gerente.js";
import { ErroDeDominio } from "./dominio/erros.js";
import { RepositorioDoSalaoEmMemoria } from "./infra/memoria/repositorio-do-salao-em-memoria.js";

// As mesas sao configuracao de abertura do salao, nao operacao de runtime.
const motor = new MotorGerente(
    new RepositorioDoSalaoEmMemoria({
        mesas: [new Mesa("m1", 1, 2), new Mesa("m2", 2, 4), new Mesa("m3", 3, 6)]
    })
);

const titulo = (texto: string): void => {
    console.log(`\n--- ${texto} ---`);
};

const recuo = (texto: string): void => {
    console.log(`          ${texto}`);
};

/** Recebe quem chegou: o motor decide entre mesa e fila pela ordem de chegada. */
async function chegou(nome: string, pessoas: number, telefone: string): Promise<Cliente> {
    const cliente = new Cliente(nome, pessoas, telefone);
    const recepcao = await motor.receberCliente(cliente);

    if (recepcao.destino === "mesa") {
        console.log(
            `[SENTOU] ${nome} (${pessoas}p) → Mesa ${recepcao.mesa.numero}, de ${recepcao.mesa.capacidade} lugares.`
        );
    } else {
        console.log(`[FILA]   ${nome} (${pessoas}p) → posição ${recepcao.posicao} na fila.`);
    }
    return cliente;
}

async function liberar(rotulo: string, mesaId: string): Promise<void> {
    const r = await motor.liberarMesa(mesaId);
    console.log(`[${rotulo}] Mesa ${r.mesaNumero} liberada por ${r.clienteAnterior.nome}.`);
    if (r.atendido === null) {
        recuo("Ninguém na fila cabia nesta mesa — segue disponível.");
    } else {
        recuo(`${r.atendido.nome} saiu da fila e ficou com a mesa.`);
    }
}

async function demonstrar(): Promise<void> {
    console.log("=".repeat(60));
    console.log(" GESTÃO DE FILAS E RESERVAS — atendimento por ordem de chegada");
    console.log("=".repeat(60));
    recuo("Salão: mesas de 2, 4 e 6 lugares.");

    titulo("Cada grupo vai para a menor mesa que o acomoda");
    await chegou("Ana e Bruno", 2, "1111-1111");
    await chegou("Família Costa", 4, "2222-2222");
    await chegou("Turma do escritório", 6, "3333-3333");
    recuo(`Taxa de ocupação: ${await motor.taxaDeOcupacao()}%`);

    titulo("Salão cheio: começa a fila");
    await chegou("Trio do cinema", 3, "4444-4444");
    const dupla = await chegou("Casal Dias", 2, "5555-5555");

    titulo("A mesa de 2 vira — e vai para quem cabe nela");
    await liberar("LIBERADA", "m1");
    recuo("O trio continua na fila: 3 pessoas não cabem numa mesa de 2.");
    recuo(`Fila agora: ${await motor.tamanhoFilaEspera()} grupo(s).`);

    titulo("O grupo maior na fila não bloqueia a mesa pequena");
    await motor.liberarMesa("m1");
    recuo(`${dupla.nome} foi embora, a mesa de 2 está livre e o trio não cabe nela.`);
    await chegou("Casal Nogueira", 2, "6666-6666");
    recuo(`O trio segue esperando por uma mesa que sirva. Fila: ${await motor.tamanhoFilaEspera()}.`);

    titulo("O grupo da mesa de 4 chegou e sentou");
    const m2 = await motor.ocuparMesa("m2");
    recuo(`Mesa ${m2.numero} agora está ${m2.status} com ${m2.cliente?.nome}.`);
    recuo(`Ocupação segue em ${await motor.taxaDeOcupacao()}% — ocupada conta igual a reservada.`);

    titulo("A mesa de 4 vira: agora o trio cabe");
    await liberar("LIBERADA", "m2");

    titulo("Ordem de chegada vale até para o anfitrião");
    await motor.liberarMesa("m3");
    const helena = new Cliente("Helena", 2, "7777-7777");
    await motor.entrarNaFila(helena);
    recuo("Helena foi anotada na lista de espera e a mesa de 6 está livre.");

    try {
        await motor.fazerReserva("m3", new Cliente("Recém-chegado", 2, "8888-8888"));
        throw new Error("A demonstração esperava uma recusa que não aconteceu.");
    } catch (erro) {
        if (!(erro instanceof ErroDeDominio)) {
            throw erro;
        }
        console.log(`[RECUSADA] ${erro.name}: ${erro.message}`);
    }

    const daHelena = await motor.fazerReserva("m3", helena);
    console.log(`[SENTOU] Helena → Mesa ${daHelena.mesaNumero}.`);
    recuo(`Ela saiu da fila ao sentar. Fila: ${await motor.tamanhoFilaEspera()}.`);

    titulo("Grupo que nenhuma mesa acomoda é recusado na porta");
    try {
        await motor.receberCliente(new Cliente("Excursão", 20, "9999-9999"));
    } catch (erro) {
        if (erro instanceof ErroDeDominio) {
            console.log(`[RECUSADA] ${erro.name}: ${erro.message}`);
            recuo("Melhor recusar do que fazer esperar por uma mesa que não existe.");
        }
    }

    titulo("Relatório");
    const relatorio = await motor.gerarRelatorio();
    console.log(`Taxa de ocupação ..... ${relatorio.taxaOcupacaoPercentual}%`);
    console.log(`Tempo médio de espera  ${relatorio.tempoMedioEsperaSegundos}s`);
    console.log(`Grupos na fila ....... ${relatorio.tamanhoFila}`);
    for (const mesa of relatorio.mesas) {
        const ocupante = mesa.cliente === null ? "—" : mesa.cliente.nome;
        console.log(`  Mesa ${mesa.numero} (${mesa.capacidade} lug.) ${mesa.status.padEnd(11)} ${ocupante}`);
    }
}

demonstrar().catch((erro: unknown) => {
    console.error("A demonstração falhou:", erro);
    process.exitCode = 1;
});
