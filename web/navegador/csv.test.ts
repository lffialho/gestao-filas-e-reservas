import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { montarCsv } from "./csv.js";

/**
 * O escape é a parte do CSV que quebra em produção e não no teste de mesa:
 * basta um cliente chamado "Ana; Bruno" para a planilha do dono sair com uma
 * coluna a mais e todos os números deslocados.
 */
describe("montarCsv", () => {
    it("separa por ponto e vírgula e termina as linhas em CRLF", () => {
        assert.equal(montarCsv(["mesa", "giros"], [[1, 3]]), "mesa;giros\r\n1;3\r\n");
    });

    it("põe entre aspas o campo que tem o separador", () => {
        assert.equal(montarCsv(["nome"], [["Ana; Bruno"]]), 'nome\r\n"Ana; Bruno"\r\n');
    });

    it("dobra as aspas de dentro do campo", () => {
        assert.equal(montarCsv(["nome"], [['Turma do "Zé"']]), 'nome\r\n"Turma do ""Zé"""\r\n');
    });

    it("protege quebra de linha dentro do campo", () => {
        assert.equal(montarCsv(["nome"], [["Ana\nBruno"]]), 'nome\r\n"Ana\nBruno"\r\n');
    });

    it("escreve célula vazia para nulo, e não a palavra null", () => {
        assert.equal(montarCsv(["a", "b"], [[null, 2]]), "a;b\r\n;2\r\n");
    });

    it("não põe aspas no que não precisa", () => {
        assert.equal(montarCsv(["nome"], [["Família Costa"]]), "nome\r\nFamília Costa\r\n");
    });

    /**
     * O fechamento junta duas tabelas num arquivo só. Enquanto o BOM saía daqui,
     * o segundo cabeçalho vinha com um BOM no meio do arquivo — e no Excel a
     * coluna passava a se chamar "﻿Mesa", com um caractere invisível na frente.
     * Quem põe o BOM é `baixarCsv`, uma vez, no começo do arquivo.
     */
    it("não põe BOM: duas tabelas emendadas continuam um arquivo só", () => {
        const arquivo = `${montarCsv(["a"], [[1]])}\r\n${montarCsv(["b"], [[2]])}`;

        assert.ok(!arquivo.includes("﻿"), "nenhum BOM, nem no começo nem no meio");
        assert.equal(arquivo, "a\r\n1\r\n\r\nb\r\n2\r\n");
    });
});
