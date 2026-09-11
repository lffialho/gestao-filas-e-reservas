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

    it("podeAcomodar compara com a capacidade", () => {
        const mesa = new Mesa("m1", 1, 4);
        assert.equal(mesa.podeAcomodar(4), true);
        assert.equal(mesa.podeAcomodar(5), false);
    });
});
