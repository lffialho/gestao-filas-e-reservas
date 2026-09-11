import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FilaDeEspera } from "./fila-de-espera.js";
import { Cliente } from "./cliente.js";
import type { Relogio } from "../../compartilhado/tempo/relogio.js";
import { ClienteJaNaFila, ItemForaDaFila } from "../erros.js";

/** Relógio controlado: o tempo de espera é testado sem esperar de verdade. */
class RelogioFalso implements Relogio {
    #instante: number;

    constructor(inicio = 0) {
        this.#instante = inicio;
    }

    agora(): Date {
        return new Date(this.#instante);
    }

    avancarSegundos(segundos: number): void {
        this.#instante += segundos * 1000;
    }
}

const cliente = (nome: string, pessoas: number, telefone: string): Cliente =>
    new Cliente(nome, pessoas, telefone);

describe("FilaDeEspera", () => {
    it("começa vazia", () => {
        const fila = new FilaDeEspera();
        assert.equal(fila.estaVazia(), true);
        assert.equal(fila.tamanhoDaFila, 0);
        assert.equal(fila.tempoMedioDeEsperaEmSegundos, 0);
    });

    it("adiciona e conta", () => {
        const fila = new FilaDeEspera();
        const item = fila.adicionar(cliente("Ana", 2, "1111"));

        assert.equal(item.cliente.nome, "Ana");
        assert.equal(fila.tamanhoDaFila, 1);
        assert.equal(item.dataAtendimento, undefined);
    });

    it("recusa o mesmo telefone duas vezes", () => {
        const fila = new FilaDeEspera();
        fila.adicionar(cliente("Ana", 2, "1111"));
        assert.throws(() => fila.adicionar(cliente("Ana de novo", 2, "1111")), ClienteJaNaFila);
        assert.equal(fila.tamanhoDaFila, 1);
    });

    describe("remover", () => {
        it("remove pelo telefone", () => {
            const fila = new FilaDeEspera();
            fila.adicionar(cliente("Ana", 2, "1111"));
            fila.adicionar(cliente("Bruno", 2, "2222"));

            assert.equal(fila.remover("1111")?.cliente.nome, "Ana");
            assert.equal(fila.tamanhoDaFila, 1);
        });

        it("devolve null para telefone desconhecido", () => {
            const fila = new FilaDeEspera();
            assert.equal(fila.remover("9999"), null);
        });

        it("não conta desistência como atendimento", () => {
            const fila = new FilaDeEspera();
            fila.adicionar(cliente("Ana", 2, "1111"));
            fila.remover("1111");
            assert.equal(fila.tempoMedioDeEsperaEmSegundos, 0);
        });
    });

    describe("proximoCompativel", () => {
        it("escolhe o primeiro da fila que cabe na mesa", () => {
            const fila = new FilaDeEspera();
            fila.adicionar(cliente("Grupo grande", 6, "1111"));
            fila.adicionar(cliente("Casal", 2, "2222"));

            assert.equal(fila.proximoCompativel(2)?.cliente.nome, "Casal");
        });

        it("respeita a ordem de chegada entre os que cabem", () => {
            const fila = new FilaDeEspera();
            fila.adicionar(cliente("Primeiro", 2, "1111"));
            fila.adicionar(cliente("Segundo", 2, "2222"));

            assert.equal(fila.proximoCompativel(4)?.cliente.nome, "Primeiro");
        });

        it("devolve null quando ninguém cabe", () => {
            const fila = new FilaDeEspera();
            fila.adicionar(cliente("Grupo grande", 8, "1111"));
            assert.equal(fila.proximoCompativel(4), null);
        });

        // Regressão: antes esse método removia o cliente da fila. Se a reserva
        // falhasse depois, o cliente tinha sumido sem ganhar mesa.
        it("não remove ninguém da fila", () => {
            const fila = new FilaDeEspera();
            fila.adicionar(cliente("Ana", 2, "1111"));

            fila.proximoCompativel(4);
            fila.proximoCompativel(4);

            assert.equal(fila.tamanhoDaFila, 1, "espiar não consome a fila");
            assert.equal(fila.tempoMedioDeEsperaEmSegundos, 0, "nem contabiliza espera");
        });
    });

    describe("confirmarAtendimento", () => {
        it("tira da fila e registra o tempo esperado", () => {
            const relogio = new RelogioFalso();
            const fila = new FilaDeEspera(relogio);
            const item = fila.adicionar(cliente("Ana", 2, "1111"));

            relogio.avancarSegundos(90);
            fila.confirmarAtendimento(item);

            assert.equal(fila.tamanhoDaFila, 0);
            assert.equal(item.dataAtendimento?.getTime(), 90_000);
            assert.equal(fila.tempoMedioDeEsperaEmSegundos, 90);
        });

        it("faz a média entre vários atendimentos", () => {
            const relogio = new RelogioFalso();
            const fila = new FilaDeEspera(relogio);

            const primeiro = fila.adicionar(cliente("Ana", 2, "1111"));
            relogio.avancarSegundos(10);
            fila.confirmarAtendimento(primeiro);

            const segundo = fila.adicionar(cliente("Bruno", 2, "2222"));
            relogio.avancarSegundos(30);
            fila.confirmarAtendimento(segundo);

            assert.equal(fila.tempoMedioDeEsperaEmSegundos, 20);
        });

        it("recusa confirmar item que já saiu da fila", () => {
            const fila = new FilaDeEspera();
            const item = fila.adicionar(cliente("Ana", 2, "1111"));
            fila.confirmarAtendimento(item);

            assert.throws(() => fila.confirmarAtendimento(item), ItemForaDaFila);
        });
    });
});
