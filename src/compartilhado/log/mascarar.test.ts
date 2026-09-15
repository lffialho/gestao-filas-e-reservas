import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mascararCaminho, mascararNome, mascararTelefone } from "./mascarar.js";

describe("mascarar telefone", () => {
    it("guarda só os quatro últimos dígitos", () => {
        assert.equal(mascararTelefone("+5511999990001"), "••••0001");
    });

    it("não deixa o número inteiro sobrar em lugar nenhum", () => {
        const mascarado = mascararTelefone("+5511999990001");
        assert.equal(mascarado.includes("5511999990"), false);
        assert.equal(mascarado.includes("99999"), false);
    });

    it("ignora pontuação ao contar os dígitos", () => {
        assert.equal(mascararTelefone("+55 (11) 99999-0001"), "••••0001");
    });

    it("número curto demais para identificar fica como está", () => {
        assert.equal(mascararTelefone("1234"), "1234");
        assert.equal(mascararTelefone("99"), "99");
    });
});

describe("mascarar caminho de URL", () => {
    it("mascara o telefone que vai no caminho", () => {
        assert.equal(mascararCaminho("/fila/+5511999990001"), "/fila/••••0001");
    });

    it("mascara na rota de esquecimento também", () => {
        assert.equal(mascararCaminho("/clientes/+5511999990001"), "/clientes/••••0001");
    });

    it("deixa em paz caminho que não tem telefone", () => {
        for (const caminho of ["/salao", "/mesas/m1", "/saude", "/chegadas/previa?pessoas=2"]) {
            assert.equal(mascararCaminho(caminho), caminho, `mexeu em ${caminho}`);
        }
    });

    it("não confunde id de mesa com telefone", () => {
        assert.equal(mascararCaminho("/mesas/m12/ocupacao"), "/mesas/m12/ocupacao");
    });

    it("mascara telefone sem o mais", () => {
        assert.equal(mascararCaminho("/fila/5511999990001"), "/fila/••••0001");
    });

    it("pega mais de um, se houver", () => {
        const mascarado = mascararCaminho("/x/5511999990001/y/5511988887777");
        assert.equal(mascarado.includes("5511999990001"), false);
        assert.equal(mascarado.includes("5511988887777"), false);
    });
});

describe("mascarar nome", () => {
    it("some com o nome e guarda o tamanho", () => {
        assert.equal(mascararNome("Ana Silva"), "«nome de 9 caracteres»");
    });

    it("o nome não sobrevive em pedaço nenhum", () => {
        assert.equal(mascararNome("Ana Silva").includes("Ana"), false);
    });
});
