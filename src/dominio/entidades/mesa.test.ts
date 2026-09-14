import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Mesa, StatusMesa } from "./mesa.js";
import { Cliente } from "./cliente.js";
import {
    CapacidadeInsuficiente,
    DadosInvalidos,
    MesaIndisponivel,
    MesaJaDisponivel,
    TransicaoInvalida
} from "../erros.js";

const cliente = (nome: string, pessoas: number): Cliente => new Cliente(nome, pessoas, `tel-${nome}`);

class RelogioFalso {
    #instante = 0;

    agora(): Date {
        return new Date(this.#instante);
    }

    avancarSegundos(segundos: number): void {
        this.#instante += segundos * 1000;
    }
}

describe("Mesa", () => {
    describe("construção", () => {
        it("nasce disponível e sem cliente", () => {
            const mesa = new Mesa("m1", 1, 4);
            assert.equal(mesa.status, StatusMesa.DISPONIVEL);
            assert.equal(mesa.clienteAtual, null);
            assert.equal(mesa.estaDisponivel, true);
        });

        it("recusa capacidade que não acomoda ninguém", () => {
            assert.throws(() => new Mesa("m1", 1, 0), DadosInvalidos);
            assert.throws(() => new Mesa("m1", 1, -2), DadosInvalidos);
            assert.throws(() => new Mesa("m1", 1, 2.5), DadosInvalidos);
        });

        it("recusa id vazio e número inválido", () => {
            assert.throws(() => new Mesa("   ", 1, 4), DadosInvalidos);
            assert.throws(() => new Mesa("m1", 0, 4), DadosInvalidos);
        });
    });

    describe("reservar", () => {
        it("guarda quem reservou", () => {
            const mesa = new Mesa("m1", 1, 4);
            const ana = cliente("Ana", 2);
            mesa.reservar(ana);

            assert.equal(mesa.status, StatusMesa.RESERVADA);
            assert.equal(mesa.clienteAtual, ana);
        });

        it("recusa grupo maior que a capacidade", () => {
            const mesa = new Mesa("m1", 1, 2);
            assert.throws(() => mesa.reservar(cliente("Grupo", 5)), CapacidadeInsuficiente);
            assert.equal(mesa.status, StatusMesa.DISPONIVEL, "a mesa não muda de estado ao recusar");
        });

        it("recusa reserva sobre mesa já reservada", () => {
            const mesa = new Mesa("m1", 1, 4);
            mesa.reservar(cliente("Ana", 2));
            assert.throws(() => mesa.reservar(cliente("Bruno", 2)), MesaIndisponivel);
            assert.equal(mesa.clienteAtual?.nome, "Ana", "a reserva original fica intacta");
        });
    });

    describe("ocupar", () => {
        it("leva de reservada a ocupada, preservando o cliente", () => {
            const mesa = new Mesa("m1", 1, 4);
            mesa.reservar(cliente("Ana", 2));
            mesa.ocupar();

            assert.equal(mesa.status, StatusMesa.OCUPADA);
            assert.equal(mesa.clienteAtual?.nome, "Ana");
            assert.equal(mesa.estaDisponivel, false, "mesa ocupada não está disponível");
        });

        it("recusa ocupar mesa disponível ou já ocupada", () => {
            const mesa = new Mesa("m1", 1, 4);
            assert.throws(() => mesa.ocupar(), TransicaoInvalida);

            mesa.reservar(cliente("Ana", 2));
            mesa.ocupar();
            assert.throws(() => mesa.ocupar(), TransicaoInvalida);
        });
    });

    describe("liberar", () => {
        it("devolve quem estava na mesa e zera o estado", () => {
            const mesa = new Mesa("m1", 1, 4);
            const ana = cliente("Ana", 2);
            mesa.reservar(ana);

            assert.equal(mesa.liberar(), ana);
            assert.equal(mesa.status, StatusMesa.DISPONIVEL);
            assert.equal(mesa.clienteAtual, null);
        });

        it("libera também a partir de ocupada", () => {
            const mesa = new Mesa("m1", 1, 4);
            mesa.reservar(cliente("Ana", 2));
            mesa.ocupar();
            assert.equal(mesa.liberar().nome, "Ana");
        });

        // Regressão: liberar mesa já livre devolvia sucesso em silêncio.
        it("recusa liberar mesa que já está disponível", () => {
            const mesa = new Mesa("m1", 1, 4);
            assert.throws(() => mesa.liberar(), MesaJaDisponivel);
        });
    });

    describe("desde quando está no status", () => {
        it("carimba a cada transição, e só nelas", () => {
            const relogio = new RelogioFalso();
            const mesa = new Mesa("m1", 1, 4, undefined, relogio);
            assert.equal(mesa.desde.getTime(), 0, "nasce disponível agora");

            relogio.avancarSegundos(60);
            mesa.moverPara({ coluna: 3, linha: 3 });
            assert.equal(mesa.desde.getTime(), 0, "arrastar na planta não é mudança de status");

            mesa.reservar(cliente("Ana", 2));
            assert.equal(mesa.desde.getTime(), 60_000);

            relogio.avancarSegundos(300);
            mesa.ocupar();
            assert.equal(mesa.desde.getTime(), 360_000, "o relógio do prazo reinicia ao sentar");

            relogio.avancarSegundos(3_600);
            mesa.liberar();
            assert.equal(mesa.desde.getTime(), 3_960_000);
        });

        it("o retrato guarda e a reconstituição devolve", () => {
            const relogio = new RelogioFalso();
            const mesa = new Mesa("m1", 1, 4, undefined, relogio);
            relogio.avancarSegundos(90);
            mesa.reservar(cliente("Ana", 2));

            const copia = Mesa.reconstituir(mesa.estado(), relogio);
            assert.equal(copia.desde.getTime(), 90_000, "reiniciar o serviço não zera o prazo de quem foi chamado");
        });

        it("recusa data de status inválida vinda do banco", () => {
            const estado = new Mesa("m1", 1, 4).estado();
            assert.throws(() => Mesa.reconstituir({ ...estado, desde: "ontem de tarde" }), DadosInvalidos);
        });
    });

    it("podeAcomodar compara com a capacidade", () => {
        const mesa = new Mesa("m1", 1, 4);
        assert.equal(mesa.podeAcomodar(4), true);
        assert.equal(mesa.podeAcomodar(5), false);
    });
});
