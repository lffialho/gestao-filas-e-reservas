import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MotorGerente } from "./motor-gerente.js";
import { Mesa, StatusMesa } from "../entidades/mesa.js";
import { Cliente } from "../entidades/cliente.js";
import { type Relogio } from "../../compartilhado/tempo/relogio.js";
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
    const motor = relogio === undefined ? new MotorGerente() : new MotorGerente(relogio);
    motor.adicionarMesa(new Mesa("m1", 1, 4));
    motor.adicionarMesa(new Mesa("m2", 2, 2));
    return motor;
}

describe("MotorGerente", () => {
    describe("cadastro de mesas", () => {
        // Regressão: adicionarMesa devolvia o Map privado, e um clear() externo
        // apagava o salão inteiro.
        it("não entrega o estado interno a quem cadastra", () => {
            const motor = new MotorGerente();
            const retorno: unknown = motor.adicionarMesa(new Mesa("m1", 1, 4));

            assert.equal(retorno, undefined);
            assert.equal(motor.consultarMesa("m1")?.id, "m1");
        });

        it("recusa duas mesas com o mesmo id", () => {
            const motor = new MotorGerente();
            motor.adicionarMesa(new Mesa("m1", 1, 4));
            assert.throws(() => motor.adicionarMesa(new Mesa("m1", 9, 2)), MesaDuplicada);
            assert.equal(motor.consultarMesa("m1")?.numero, 1, "a mesa original não foi sobrescrita");
        });

        it("consultarMesa devolve retrato imutável, não a entidade", () => {
            const motor = montarMotor();
            const info = motor.consultarMesa("m1");

            assert.ok(info);
            assert.equal(Object.isFrozen(info), true);
            assert.equal(motor.consultarMesa("inexistente"), undefined);
        });
    });

    describe("fazerReserva", () => {
        it("reserva e registra o cliente na mesa", async () => {
            const motor = montarMotor();
            const ana = cliente("Ana", 2, "1111");
            const reserva = await motor.fazerReserva("m1", ana);

            assert.equal(reserva.status, StatusMesa.RESERVADA);
            assert.equal(reserva.mesaNumero, 1);
            assert.equal(motor.consultarMesa("m1")?.cliente?.nome, "Ana");
        });

        // Regressão: o tamanho do grupo vinha por fora e podia contradizer o cliente.
        it("tira o tamanho do grupo do próprio cliente", async () => {
            const motor = montarMotor();
            await assert.rejects(motor.fazerReserva("m2", cliente("Grupo de 8", 8, "1111")), {
                name: "CapacidadeInsuficiente"
            });
            assert.equal(motor.consultarMesa("m2")?.status, StatusMesa.DISPONIVEL);
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

    describe("taxa de ocupação", () => {
        it("é zero sem mesas cadastradas", () => {
            assert.equal(new MotorGerente().taxaDeOcupacao, 0);
        });

        // Regressão: só RESERVADA era contada, então mesa ocupada reportava 0%.
        it("conta mesa ocupada como ocupação", async () => {
            const motor = new MotorGerente();
            motor.adicionarMesa(new Mesa("m1", 1, 4));

            await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));
            assert.equal(motor.taxaDeOcupacao, 100, "reservada ocupa");

            await motor.ocuparMesa("m1");
            assert.equal(motor.consultarMesa("m1")?.status, StatusMesa.OCUPADA);
            assert.equal(motor.taxaDeOcupacao, 100, "ocupada também ocupa");
        });

        it("reflete a proporção de mesas indisponíveis", async () => {
            const motor = montarMotor();
            assert.equal(motor.taxaDeOcupacao, 0);
            await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));
            assert.equal(motor.taxaDeOcupacao, 50);
        });
    });

    describe("fila de espera", () => {
        it("entra e sai da fila pelo telefone", async () => {
            const motor = montarMotor();
            await motor.entrarNaFila(cliente("Fernando", 2, "2222"));
            assert.equal(motor.tamanhoFilaEspera, 1);

            const saiu = await motor.sairDaFila("2222");
            assert.equal(saiu?.cliente.nome, "Fernando");
            assert.equal(motor.tamanhoFilaEspera, 0);
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
            assert.equal(motor.tamanhoFilaEspera, 0);
            assert.equal(motor.consultarMesa("m1")?.cliente?.nome, "Fernando");
        });

        it("deixa a mesa disponível quando ninguém na fila cabe", async () => {
            const motor = montarMotor();
            await motor.fazerReserva("m2", cliente("Ana", 2, "1111"));
            await motor.entrarNaFila(cliente("Grupo grande", 8, "2222"));

            const resultado = await motor.liberarMesa("m2");

            assert.equal(resultado.atendido, null);
            assert.equal(resultado.status, StatusMesa.DISPONIVEL);
            assert.equal(motor.tamanhoFilaEspera, 1, "quem não cabe continua na fila");
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

            assert.equal(motor.tempoMedioEspera, 120);
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

            assert.equal(motor.consultarMesa("m1")?.cliente?.nome, "Carla");
            assert.equal(motor.tamanhoFilaEspera, 0);
        });

        it("duas mesas liberadas em paralelo não atendem o mesmo cliente", async () => {
            const motor = montarMotor();
            await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));
            await motor.fazerReserva("m2", cliente("Bruno", 2, "2222"));
            await motor.entrarNaFila(cliente("Unico", 2, "3333"));

            const [m1, m2] = await Promise.all([motor.liberarMesa("m1"), motor.liberarMesa("m2")]);

            const atendidos = [m1.atendido, m2.atendido].filter((c) => c !== null);
            assert.equal(atendidos.length, 1, "o cliente só pode sentar em uma mesa");
            assert.equal(motor.tamanhoFilaEspera, 0);
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
            assert.equal(motor.consultarMesa("m1")?.status, StatusMesa.DISPONIVEL);
            assert.equal(motor.consultarMesa("m1")?.cliente, null);
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
            assert.equal(motor.consultarMesa("m1")?.status, StatusMesa.OCUPADA);
        });
    });

    describe("gerarRelatorio", () => {
        it("é um método e devolve números, não texto formatado", async () => {
            const relogio = new RelogioFalso();
            const motor = montarMotor(relogio);
            await motor.fazerReserva("m1", cliente("Ana", 2, "1111"));
            await motor.entrarNaFila(cliente("Fernando", 2, "2222"));

            const relatorio = motor.gerarRelatorio();

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
