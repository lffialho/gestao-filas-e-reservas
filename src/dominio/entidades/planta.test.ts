import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Cliente } from "./cliente.js";
import { Mesa } from "./mesa.js";
import { Salao } from "./salao.js";
import { COLUNAS_DA_PLANTA, LINHAS_DA_PLANTA } from "./planta.js";
import { PosicaoForaDaPlanta, PosicaoOcupada, SalaoSemEspaco } from "../erros.js";

describe("planta do salão", () => {
    describe("colocar a mesa", () => {
        it("dá o primeiro ladrilho livre quando a mesa vem sem posição", () => {
            const salao = new Salao();
            salao.adicionarMesa(new Mesa("m1", 1, 2));
            salao.adicionarMesa(new Mesa("m2", 2, 2));

            assert.deepEqual(salao.consultarMesa("m1")?.posicao, { coluna: 0, linha: 0 });
            assert.deepEqual(salao.consultarMesa("m2")?.posicao, { coluna: 1, linha: 0 });
        });

        it("respeita a posição declarada", () => {
            const salao = new Salao();
            salao.adicionarMesa(new Mesa("m1", 1, 2, { coluna: 5, linha: 3 }));

            assert.deepEqual(salao.consultarMesa("m1")?.posicao, { coluna: 5, linha: 3 });
        });

        it("recusa duas mesas no mesmo ladrilho", () => {
            const salao = new Salao();
            salao.adicionarMesa(new Mesa("m1", 1, 2, { coluna: 4, linha: 4 }));

            assert.throws(
                () => salao.adicionarMesa(new Mesa("m2", 2, 2, { coluna: 4, linha: 4 })),
                PosicaoOcupada
            );
        });

        it("recusa posição fora da planta", () => {
            assert.throws(
                () => new Mesa("m1", 1, 2, { coluna: COLUNAS_DA_PLANTA, linha: 0 }),
                PosicaoForaDaPlanta
            );
            assert.throws(
                () => new Mesa("m1", 1, 2, { coluna: 0, linha: LINHAS_DA_PLANTA }),
                PosicaoForaDaPlanta
            );
            assert.throws(() => new Mesa("m1", 1, 2, { coluna: -1, linha: 0 }), PosicaoForaDaPlanta);
            assert.throws(() => new Mesa("m1", 1, 2, { coluna: 0.5, linha: 0 }), PosicaoForaDaPlanta);
        });

        it("avisa quando a planta lota", () => {
            const salao = new Salao();
            const total = COLUNAS_DA_PLANTA * LINHAS_DA_PLANTA;
            for (let i = 0; i < total; i++) {
                salao.adicionarMesa(new Mesa(`m${i}`, i + 1, 2));
            }

            assert.throws(() => salao.adicionarMesa(new Mesa("sobra", total + 1, 2)), SalaoSemEspaco);
        });
    });

    describe("arrastar a mesa", () => {
        it("move para um ladrilho livre", () => {
            const salao = new Salao();
            salao.adicionarMesa(new Mesa("m1", 1, 2, { coluna: 0, linha: 0 }));

            const movida = salao.moverMesa("m1", { coluna: 7, linha: 5 });

            assert.deepEqual(movida.posicao, { coluna: 7, linha: 5 });
            assert.deepEqual(salao.consultarMesa("m1")?.posicao, { coluna: 7, linha: 5 });
        });

        it("recusa mover para cima de outra mesa", () => {
            const salao = new Salao();
            salao.adicionarMesa(new Mesa("m1", 1, 2, { coluna: 0, linha: 0 }));
            salao.adicionarMesa(new Mesa("m2", 2, 2, { coluna: 3, linha: 3 }));

            assert.throws(() => salao.moverMesa("m1", { coluna: 3, linha: 3 }), PosicaoOcupada);
            assert.deepEqual(
                salao.consultarMesa("m1")?.posicao,
                { coluna: 0, linha: 0 },
                "não saiu do lugar"
            );
        });

        it("deixa mover para o próprio lugar, sem reclamar de si mesma", () => {
            const salao = new Salao();
            salao.adicionarMesa(new Mesa("m1", 1, 2, { coluna: 2, linha: 2 }));

            salao.moverMesa("m1", { coluna: 2, linha: 2 });
            assert.deepEqual(salao.consultarMesa("m1")?.posicao, { coluna: 2, linha: 2 });
        });

        it("recusa sair da planta", () => {
            const salao = new Salao();
            salao.adicionarMesa(new Mesa("m1", 1, 2));

            assert.throws(() => salao.moverMesa("m1", { coluna: 99, linha: 0 }), PosicaoForaDaPlanta);
        });

        // Posição é planta, não regra de atendimento: arrastar a mesa não pode
        // mexer em quem está sentado nela.
        it("mover não altera status nem ocupante", () => {
            const salao = new Salao();
            salao.adicionarMesa(new Mesa("m1", 1, 4, { coluna: 0, linha: 0 }));
            salao.receberCliente(new Cliente("Ana", 4, "1111"));

            const antes = salao.consultarMesa("m1");
            salao.moverMesa("m1", { coluna: 8, linha: 6 });
            const depois = salao.consultarMesa("m1");

            assert.equal(depois?.status, antes?.status);
            assert.equal(depois?.cliente?.nome, "Ana");
            assert.deepEqual(depois?.posicao, { coluna: 8, linha: 6 });
        });

        it("a alocação ignora posição: continua por capacidade e ordem", () => {
            const salao = new Salao();
            // A mesa pequena está "longe"; a grande, logo na entrada.
            salao.adicionarMesa(new Mesa("grande", 1, 6, { coluna: 0, linha: 0 }));
            salao.adicionarMesa(new Mesa("pequena", 2, 2, { coluna: 11, linha: 8 }));

            const recepcao = salao.receberCliente(new Cliente("Casal", 2, "1111"));

            assert.equal(recepcao.destino, "mesa");
            if (recepcao.destino !== "mesa") return;
            assert.equal(recepcao.mesa.id, "pequena", "escolhe pela capacidade, não pela distância");
        });
    });

    it("a posição sobrevive ao retrato de estado", () => {
        const salao = new Salao();
        salao.adicionarMesa(new Mesa("m1", 1, 2, { coluna: 6, linha: 4 }));

        const copia = Salao.reconstituir(salao.estado());

        assert.deepEqual(copia.consultarMesa("m1")?.posicao, { coluna: 6, linha: 4 });
    });
});
