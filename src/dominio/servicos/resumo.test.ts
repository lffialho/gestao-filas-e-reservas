import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EventoDoSalao, TipoDeEvento } from "../eventos.js";
import { resumirPeriodo } from "./resumo.js";

/** Evento com tudo em null menos o que o caso precisa. */
function evento(minuto: number, tipo: TipoDeEvento, campos: Partial<EventoDoSalao> = {}): EventoDoSalao {
    return {
        momento: new Date(minuto * 60_000).toISOString(),
        tipo,
        mesaId: campos.mesaId ?? null,
        mesaNumero: campos.mesaNumero ?? null,
        capacidade: campos.capacidade ?? null,
        telefone: campos.telefone ?? null,
        nome: campos.nome ?? null,
        pessoas: campos.pessoas ?? null,
        esperaEmSegundos: campos.esperaEmSegundos ?? null,
        permanenciaEmSegundos: campos.permanenciaEmSegundos ?? null
    };
}

describe("resumirPeriodo", () => {
    it("um período sem nada devolve zeros, não NaN", () => {
        const resumo = resumirPeriodo([]);

        assert.equal(resumo.gruposAtendidos, 0);
        assert.equal(resumo.esperaMediaSegundos, 0, "média de nada é zero, não divisão por zero");
        assert.equal(resumo.picoDaFila, 0);
        assert.deepEqual(resumo.porMesa, []);
    });

    it("conta grupos e pessoas de quem sentou, tenha passado pela fila ou não", () => {
        const resumo = resumirPeriodo([
            evento(0, "sentou_direto", { pessoas: 2 }),
            evento(1, "entrou_na_fila", { pessoas: 4 }),
            evento(5, "chamado", { pessoas: 4, esperaEmSegundos: 240 })
        ]);

        assert.equal(resumo.gruposAtendidos, 2);
        assert.equal(resumo.pessoasAtendidas, 6);
    });

    it("a média de espera ignora quem sentou direto", () => {
        const resumo = resumirPeriodo([
            evento(0, "sentou_direto", { pessoas: 2 }),
            evento(1, "chamado", { pessoas: 2, esperaEmSegundos: 600 }),
            evento(2, "chamado", { pessoas: 2, esperaEmSegundos: 300 })
        ]);

        assert.equal(
            resumo.esperaMediaSegundos,
            450,
            "juntar os zeros de quem não esperou mediria o quanto o salão estava vazio"
        );
        assert.equal(resumo.maiorEsperaSegundos, 600);
    });

    it("o pico da fila é o maior tamanho durante o período", () => {
        const resumo = resumirPeriodo([
            evento(0, "entrou_na_fila"),
            evento(1, "entrou_na_fila"),
            evento(2, "entrou_na_fila"),
            evento(3, "chamado", { esperaEmSegundos: 180 }),
            evento(4, "saiu_da_fila"),
            evento(5, "entrou_na_fila")
        ]);

        assert.equal(resumo.picoDaFila, 3);
        assert.equal(resumo.desistencias, 1);
    });

    it("não deixa a fila ficar negativa quando o período começa no meio", () => {
        // Alguém que já esperava antes do recorte é chamado dentro dele.
        const resumo = resumirPeriodo([
            evento(0, "chamado", { esperaEmSegundos: 900 }),
            evento(1, "chamado", { esperaEmSegundos: 900 }),
            evento(2, "entrou_na_fila")
        ]);

        assert.equal(resumo.picoDaFila, 1, "conta do zero, sem descontar quem já esperava antes");
    });

    it("ordena os eventos antes de somar, mesmo fora de ordem", () => {
        const resumo = resumirPeriodo([
            evento(5, "chamado", { esperaEmSegundos: 60 }),
            evento(0, "entrou_na_fila"),
            evento(1, "entrou_na_fila")
        ]);

        assert.equal(resumo.picoDaFila, 2);
    });

    it("por mesa: giro, permanência média e aproveitamento dos lugares", () => {
        const resumo = resumirPeriodo([
            evento(60, "liberou", {
                mesaId: "m5",
                mesaNumero: 5,
                capacidade: 6,
                pessoas: 3,
                permanenciaEmSegundos: 3_600
            }),
            evento(120, "liberou", {
                mesaId: "m5",
                mesaNumero: 5,
                capacidade: 6,
                pessoas: 6,
                permanenciaEmSegundos: 5_400
            }),
            evento(70, "liberou", {
                mesaId: "m1",
                mesaNumero: 1,
                capacidade: 2,
                pessoas: 2,
                permanenciaEmSegundos: 1_800
            })
        ]);

        assert.deepEqual(
            resumo.porMesa.map((mesa) => mesa.mesaNumero),
            [1, 5],
            "sai ordenado pelo número da mesa"
        );

        const m5 = resumo.porMesa.find((mesa) => mesa.mesaId === "m5");
        assert.ok(m5);
        assert.equal(m5.giros, 2);
        assert.equal(m5.permanenciaMediaSegundos, 4_500);
        assert.equal(m5.aproveitamentoPercentual, 75, "média de 50% e 100%");
    });

    it("reserva cancelada não conta como giro — a mesa ficou parada", () => {
        const resumo = resumirPeriodo([
            evento(10, "reserva_cancelada", {
                mesaId: "m1",
                mesaNumero: 1,
                capacidade: 2,
                pessoas: 2,
                permanenciaEmSegundos: 300
            })
        ]);

        assert.equal(resumo.reservasCanceladas, 1);
        assert.deepEqual(resumo.porMesa, [], "nenhum atendimento terminou nessa mesa");
    });
});
