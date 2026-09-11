import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { criarRegistradorJson, descreverErro, type Nivel } from "./registrador.js";

function capturar(): { linhas: { linha: string; nivel: Nivel }[]; escrever: (l: string, n: Nivel) => void } {
    const linhas: { linha: string; nivel: Nivel }[] = [];
    return { linhas, escrever: (linha, nivel) => linhas.push({ linha, nivel }) };
}

describe("registrador JSON", () => {
    it("escreve uma linha JSON por evento, com momento e nível", () => {
        const { linhas, escrever } = capturar();
        const registrador = criarRegistradorJson({
            escrever,
            agora: () => new Date("2026-09-11T12:00:00.000Z")
        });

        registrador.info("requisicao", { metodo: "GET", status: 200 });

        assert.equal(linhas.length, 1);
        assert.deepEqual(JSON.parse(linhas[0]?.linha ?? ""), {
            momento: "2026-09-11T12:00:00.000Z",
            nivel: "info",
            evento: "requisicao",
            metodo: "GET",
            status: 200
        });
    });

    it("repete o contexto em toda linha", () => {
        const { linhas, escrever } = capturar();
        const registrador = criarRegistradorJson({ escrever, contexto: { servico: "salao" } });

        registrador.info("um");
        registrador.aviso("dois");

        for (const { linha } of linhas) {
            assert.equal(JSON.parse(linha).servico, "salao");
        }
    });

    it("separa erro dos demais níveis, para ir a outro destino", () => {
        const { linhas, escrever } = capturar();
        const registrador = criarRegistradorJson({ escrever });

        registrador.info("a");
        registrador.aviso("b");
        registrador.erro("c");

        assert.deepEqual(
            linhas.map((l) => l.nivel),
            ["info", "aviso", "erro"]
        );
    });

    it("campos do evento vencem o contexto", () => {
        const { linhas, escrever } = capturar();
        const registrador = criarRegistradorJson({ escrever, contexto: { origem: "padrao" } });

        registrador.info("evento", { origem: "especifica" });

        assert.equal(JSON.parse(linhas[0]?.linha ?? "").origem, "especifica");
    });
});

describe("descreverErro", () => {
    it("extrai tipo, mensagem e pilha de um Error", () => {
        const descricao = descreverErro(new TypeError("coisa errada"));

        assert.equal(descricao["erroTipo"], "TypeError");
        assert.equal(descricao["erroMensagem"], "coisa errada");
        assert.equal(typeof descricao["erroPilha"], "string");
    });

    it("lida com o que não é Error", () => {
        assert.deepEqual(descreverErro("só um texto"), {
            erroTipo: "string",
            erroMensagem: "só um texto"
        });
    });
});
