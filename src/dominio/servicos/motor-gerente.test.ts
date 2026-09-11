import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MotorGerente } from "./motor-gerente.js";
import { Mesa, StatusMesa } from "../entidades/mesa.js";
import { Cliente } from "../entidades/cliente.js";
import { type Relogio } from "../../compartilhado/tempo/relogio.js";
import { RepositorioDoSalaoEmMemoria } from "../../infra/memoria/repositorio-do-salao-em-memoria.js";
import {
    CancelamentoInvalido,
    MesaDuplicada,
    MesaIndisponivel,
    MesaJaDisponivel,
    MesaNaoEncontrada
} from "../erros.js";

class RelogioFalso implements Relogio {
    #instante = 0;

    agora(): Date {
        return new Date(this.#instante);
    }

    avancarSegundos(segundos: number): void {
        this.#instante += segundos * 1000;
    }
}

const cliente = (nome: string, pessoas: number, telefone: string): Cliente =>
    new Cliente(nome, pessoas, telefone);

/** Motor com duas mesas: m1 para 4 pessoas, m2 para 2. */
function montarMotor(relogio?: Relogio): MotorGerente {
    return new MotorGerente(
        new RepositorioDoSalaoEmMemoria({
            mesas: [new Mesa("m1", 1, 4), new Mesa("m2", 2, 2)],
            relogio
        })
    );
}

/** Motor sem mesa nenhuma. */
function motorVazio(): MotorGerente {
    return new MotorGerente(new RepositorioDoSalaoEmMemoria());
}

describe("MotorGerente", () => {
    describe("o estado vive no repositório, não no serviço", () => {
        it("dois motores sobre o mesmo repositório veem o mesmo salão", async () => {
            const repositorio = new RepositorioDoSalaoEmMemoria({ mesas: [new Mesa("m1", 1, 4)] });
            const recepcao = new MotorGerente(repositorio);
            const caixa = new MotorGerente(repositorio);

            await recepcao.receberCliente(cliente("Ana", 2, "1111"));

            assert.equal((await caixa.consultarMesa("m1"))?.cliente?.nome, "Ana");
            assert.equal(await caixa.taxaDeOcupacao(), 100);
        });

        it("motores sobre repositórios distintos não se misturam", async () => {
            const primeiro = montarMotor();
            const segundo = montarMotor();

            await primeiro.receberCliente(cliente("Ana", 2, "1111"));

            assert.equal(await primeiro.taxaDeOcupacao(), 50);
            assert.equal(await segundo.taxaDeOcupacao(), 0);
        });
    });

    describe("cadastro de mesas", () => {
        // Regressão: adicionarMesa devolvia o Map privado, e um clear() externo
        // apagava o salão inteiro.
        it("não entrega o estado interno a quem cadastra", async () => {
            const motor = motorVazio();
            const retorno: unknown = await motor.adicionarMesa(new Mesa("m1", 1, 4));

            assert.equal(retorno, undefined);
            assert.equal((await motor.consultarMesa("m1"))?.id, "m1");
        });

        it("recusa duas mesas com o mesmo id", async () => {
            const motor = motorVazio();
            await motor.adicionarMesa(new Mesa("m1", 1, 4));

            await assert.rejects(motor.adicionarMesa(new Mesa("m1", 9, 2)), MesaDuplicada);
            assert.equal(
                (await motor.consultarMesa("m1"))?.numero,
                1,
                "a mesa original não foi sobrescrita"
            );
        });

        it("consultarMesa devolve retrato imutável, não a entidade", async () => {
            const motor = montarMotor();
            const info = await motor.consultarMesa("m1");

            assert.ok(info);
            assert.equal(Object.isFrozen(info), true);
            assert.equal(await motor.consultarMesa("inexistente"), undefined);
        });
    });

    describe("fazerReserva", () => {
        it("reserva e registra o cliente na mesa", async () => {
            const motor = montarMotor();
            const reserva = await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));

            assert.equal(reserva.status, StatusMesa.RESERVADA);
            assert.equal(reserva.mesaNumero, 1);
            assert.equal((await motor.consultarMesa("m1"))?.cliente?.nome, "Ana");
        });

        // Regressão: o tamanho do grupo vinha por fora e podia contradizer o cliente.
        it("tira o tamanho do grupo do próprio cliente", async () => {
            const motor = montarMotor();
            await assert.rejects(motor.fazerReserva("m2", cliente("Grupo de 8", 8, "1111")), {
                name: "CapacidadeInsuficiente"
            });
            assert.equal((await motor.consultarMesa("m2"))?.status, StatusMesa.DISPONIVEL);
        });

        it("não deixa quem acabou de chegar furar a fila", async () => {
            const motor = montarMotor();
            // Fernando espera por uma mesa de 2 desde antes.
            await motor.entrarNaFila(cliente("Fernando", 2, "2222"));

            await assert.rejects(motor.fazerReserva("m2", cliente("Recem-chegado", 2, "9999")), {
                name: "FilaTemPrioridade"
            });
            assert.equal((await motor.consultarMesa("m2"))?.status, StatusMesa.DISPONIVEL);
        });

        it("deixa o anfitrião sentar quem está na fila, removendo-o dela", async () => {
            const motor = montarMotor();
            const fernando = cliente("Fernando", 2, "2222");
            await motor.entrarNaFila(fernando);

            const reserva = await motor.fazerReserva("m1", fernando);

            assert.equal(reserva.cliente.nome, "Fernando");
            assert.equal(await motor.tamanhoFilaEspera(), 0, "saiu da fila ao sentar");
            assert.equal((await motor.consultarMesa("m1"))?.cliente?.nome, "Fernando");
        });

        it("recusa mesa inexistente", async () => {
            const motor = montarMotor();
            await assert.rejects(motor.fazerReserva("m99", cliente("Ana", 2, "1111")), MesaNaoEncontrada);
        });

        it("recusa reservar mesa já reservada", async () => {
            const motor = montarMotor();
            await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));
            await assert.rejects(motor.fazerReserva("m1", cliente("Bruno", 2, "2222")), MesaIndisponivel);
        });

        it("serializa reservas concorrentes na mesma mesa: só uma vence", async () => {
            const motor = montarMotor();
            const resultados = await Promise.allSettled([
                motor.fazerReserva("m1", cliente("Ana", 2, "1111")),
                motor.fazerReserva("m1", cliente("Bruno", 2, "2222")),
                motor.fazerReserva("m1", cliente("Carla", 2, "3333"))
            ]);

            const aceitas = resultados.filter((r) => r.status === "fulfilled");
            assert.equal(aceitas.length, 1, "uma mesa não pode ser reservada duas vezes");
        });
    });

    describe("receberCliente — ordem de chegada", () => {
        it("senta na menor mesa que acomoda o grupo", async () => {
            const motor = montarMotor();
            const resultado = await motor.receberCliente(cliente("Casal", 2, "1111"));

            assert.equal(resultado.destino, "mesa");
            if (resultado.destino !== "mesa") return;
            assert.equal(resultado.mesa.capacidade, 2, "não gasta a mesa de 4 com um casal");
            assert.equal(resultado.mesa.cliente?.nome, "Casal");
        });

        it("manda para a fila quando não há mesa livre que sirva", async () => {
            const motor = montarMotor();
            await motor.receberCliente(cliente("Ana", 2, "1111"));
            await motor.receberCliente(cliente("Bruno", 2, "2222"));

            const terceiro = await motor.receberCliente(cliente("Carla", 2, "3333"));

            assert.equal(terceiro.destino, "fila");
            if (terceiro.destino !== "fila") return;
            assert.equal(terceiro.posicao, 1);
        });

        it("quem chegou depois não passa na frente de quem espera", async () => {
            const motor = montarMotor();
            await motor.receberCliente(cliente("Ana", 4, "1111"));
            await motor.receberCliente(cliente("Bruno", 2, "2222"));
            await motor.receberCliente(cliente("Fernando", 2, "3333"));

            // A m2 vira, mas é o Fernando quem a recebe.
            await motor.liberarMesa("m2");
            assert.equal((await motor.consultarMesa("m2"))?.cliente?.nome, "Fernando");

            // Agora a m1 vira e um recém-chegado tenta pegá-la.
            await motor.liberarMesa("m1");
            const novo = await motor.receberCliente(cliente("Recem-chegado", 2, "4444"));
            assert.equal(novo.destino, "mesa", "fila vazia: pode sentar");
        });

        it("grupo grande na fila não bloqueia mesa em que ele não cabe", async () => {
            const motor = montarMotor();
            await motor.receberCliente(cliente("Ana", 4, "1111"));
            const grupo = await motor.receberCliente(cliente("Grupo de 4", 4, "2222"));
            assert.equal(grupo.destino, "fila");

            // A m2 (2 lug.) está livre e o grupo de 4 não cabe nela:
            // o casal que chega agora deve ser sentado, não barrado.
            const casal = await motor.receberCliente(cliente("Casal", 2, "3333"));

            assert.equal(casal.destino, "mesa");
            if (casal.destino !== "mesa") return;
            assert.equal(casal.mesa.id, "m2");
            assert.equal(await motor.tamanhoFilaEspera(), 1, "o grupo de 4 continua esperando");
        });

        it("recusa grupo maior que a maior mesa do salão", async () => {
            const motor = montarMotor();
            await assert.rejects(motor.receberCliente(cliente("Excursão", 20, "1111")), {
                name: "GrupoSemMesaPossivel"
            });
            assert.equal(await motor.tamanhoFilaEspera(), 0, "não faz esperar por mesa que não existe");
        });

        it("recepções concorrentes não dão a mesma mesa a dois clientes", async () => {
            const motor = new MotorGerente(
                new RepositorioDoSalaoEmMemoria({ mesas: [new Mesa("unica", 1, 2)] })
            );

            const resultados = await Promise.all([
                motor.receberCliente(cliente("Ana", 2, "1111")),
                motor.receberCliente(cliente("Bruno", 2, "2222"))
            ]);

            const naMesa = resultados.filter((r) => r.destino === "mesa");
            assert.equal(naMesa.length, 1, "só um pode sentar");
            assert.equal(await motor.tamanhoFilaEspera(), 1, "o outro foi para a fila");
        });
    });

    describe("taxa de ocupação", () => {
        it("é zero sem mesas cadastradas", async () => {
            assert.equal(await motorVazio().taxaDeOcupacao(), 0);
        });

        // Regressão: só RESERVADA era contada, então mesa ocupada reportava 0%.
        it("conta mesa ocupada como ocupação", async () => {
            const motor = new MotorGerente(
                new RepositorioDoSalaoEmMemoria({ mesas: [new Mesa("m1", 1, 4)] })
            );

            await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));
            assert.equal(await motor.taxaDeOcupacao(), 100, "reservada ocupa");

            await motor.ocuparMesa("m1");
            assert.equal((await motor.consultarMesa("m1"))?.status, StatusMesa.OCUPADA);
            assert.equal(await motor.taxaDeOcupacao(), 100, "ocupada também ocupa");
        });

        it("reflete a proporção de mesas indisponíveis", async () => {
            const motor = montarMotor();
            assert.equal(await motor.taxaDeOcupacao(), 0);
            await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));
            assert.equal(await motor.taxaDeOcupacao(), 50);
        });
    });

    describe("fila de espera", () => {
        it("entra e sai da fila pelo telefone", async () => {
            const motor = montarMotor();
            await motor.entrarNaFila(cliente("Fernando", 2, "2222"));
            assert.equal(await motor.tamanhoFilaEspera(), 1);

            const saiu = await motor.sairDaFila("2222");
            assert.equal(saiu?.cliente.nome, "Fernando");
            assert.equal(await motor.tamanhoFilaEspera(), 0);
        });

        it("sairDaFila devolve null para quem não está na fila", async () => {
            const motor = montarMotor();
            assert.equal(await motor.sairDaFila("9999"), null);
        });
    });

    describe("liberarMesa", () => {
        it("informa quem saiu e quem assumiu a mesa", async () => {
            const motor = montarMotor();
            await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));
            await motor.entrarNaFila(cliente("Fernando", 3, "2222"));

            const resultado = await motor.liberarMesa("m1");

            assert.equal(resultado.clienteAnterior.nome, "Ana");
            assert.equal(resultado.atendido?.nome, "Fernando");
            assert.equal(resultado.status, StatusMesa.RESERVADA);
            assert.equal(await motor.tamanhoFilaEspera(), 0);
            assert.equal((await motor.consultarMesa("m1"))?.cliente?.nome, "Fernando");
        });

        it("deixa a mesa disponível quando ninguém na fila cabe", async () => {
            const motor = montarMotor();
            await motor.fazerReserva("m2", cliente("Ana", 2, "1111"));
            await motor.entrarNaFila(cliente("Grupo grande", 8, "2222"));

            const resultado = await motor.liberarMesa("m2");

            assert.equal(resultado.atendido, null);
            assert.equal(resultado.status, StatusMesa.DISPONIVEL);
            assert.equal(await motor.tamanhoFilaEspera(), 1, "quem não cabe continua na fila");
        });

        // Regressão: liberar mesa livre respondia { sucesso: true }.
        it("recusa liberar mesa que já está disponível", async () => {
            const motor = montarMotor();
            await assert.rejects(motor.liberarMesa("m1"), MesaJaDisponivel);
        });

        it("contabiliza o tempo que o cliente esperou na fila", async () => {
            const relogio = new RelogioFalso();
            const motor = montarMotor(relogio);
            await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));
            await motor.entrarNaFila(cliente("Fernando", 2, "2222"));

            relogio.avancarSegundos(120);
            await motor.liberarMesa("m1");

            assert.equal(await motor.tempoMedioEspera(), 120);
        });

        it("liberações concorrentes da mesma mesa rodam em sequência, não entrelaçadas", async () => {
            const motor = montarMotor();
            await motor.fazerReserva("m1", cliente("Ana", 4, "1111"));
            await motor.entrarNaFila(cliente("Fernando", 2, "2222"));
            await motor.entrarNaFila(cliente("Carla", 2, "3333"));

            const [primeira, segunda] = await Promise.all([
                motor.liberarMesa("m1"),
                motor.liberarMesa("m1")
            ]);

            assert.equal(primeira.clienteAnterior.nome, "Ana");
            assert.equal(primeira.atendido?.nome, "Fernando");

            // A prova da serialização: a segunda liberação só viu a mesa depois
            // que a primeira terminou de sentar o Fernando nela.
            assert.equal(segunda.clienteAnterior.nome, "Fernando");
            assert.equal(segunda.atendido?.nome, "Carla");

            assert.equal((await motor.consultarMesa("m1"))?.cliente?.nome, "Carla");
            assert.equal(await motor.tamanhoFilaEspera(), 0);
        });

        it("duas mesas liberadas em paralelo não atendem o mesmo cliente", async () => {
            const motor = montarMotor();
            await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));
            await motor.fazerReserva("m2", cliente("Bruno", 2, "2222"));
            await motor.entrarNaFila(cliente("Unico", 2, "3333"));

            const [m1, m2] = await Promise.all([motor.liberarMesa("m1"), motor.liberarMesa("m2")]);

            const atendidos = [m1.atendido, m2.atendido].filter((c) => c !== null);
            assert.equal(atendidos.length, 1, "o cliente só pode sentar em uma mesa");
            assert.equal(await motor.tamanhoFilaEspera(), 0);
        });
    });

    describe("cancelarReserva", () => {
        // Regressão: cancelarReserva recebia telefone e só mexia na fila — a
        // mesa continuava reservada para sempre.
        it("libera de fato a mesa reservada", async () => {
            const motor = montarMotor();
            await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));

            const resultado = await motor.cancelarReserva("m1");

            assert.equal(resultado.clienteAnterior.nome, "Ana");
            assert.equal(resultado.atendido, null);
            assert.equal((await motor.consultarMesa("m1"))?.status, StatusMesa.DISPONIVEL);
            assert.equal((await motor.consultarMesa("m1"))?.cliente, null);
        });

        it("passa a mesa para o próximo da fila que couber", async () => {
            const motor = montarMotor();
            await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));
            await motor.entrarNaFila(cliente("Fernando", 4, "2222"));

            const resultado = await motor.cancelarReserva("m1");
            assert.equal(resultado.atendido?.nome, "Fernando");
        });

        it("recusa cancelar mesa sem reserva", async () => {
            const motor = montarMotor();
            await assert.rejects(motor.cancelarReserva("m1"), CancelamentoInvalido);
        });

        it("recusa cancelar reserva de mesa já ocupada", async () => {
            const motor = montarMotor();
            await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));
            await motor.ocuparMesa("m1");

            await assert.rejects(motor.cancelarReserva("m1"), CancelamentoInvalido);
            assert.equal((await motor.consultarMesa("m1"))?.status, StatusMesa.OCUPADA);
        });
    });

    describe("gerarRelatorio", () => {
        it("devolve números, não texto formatado", async () => {
            const relogio = new RelogioFalso();
            const motor = montarMotor(relogio);
            await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));
            await motor.entrarNaFila(cliente("Fernando", 2, "2222"));

            const relatorio = await motor.gerarRelatorio();

            assert.equal(typeof relatorio.taxaOcupacaoPercentual, "number");
            assert.equal(relatorio.taxaOcupacaoPercentual, 50);
            assert.equal(relatorio.tempoMedioEsperaSegundos, 0);
            assert.equal(relatorio.tamanhoFila, 1);
            assert.equal(relatorio.mesas.length, 2);
            assert.equal(relatorio.mesas[0]?.cliente?.nome, "Ana");
            assert.equal(relatorio.mesas[1]?.cliente, null);
        });
    });
});
