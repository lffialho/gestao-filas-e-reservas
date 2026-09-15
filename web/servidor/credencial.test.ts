import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    chaveDeSessao,
    criarCredencial,
    gravarCredencial,
    lerCredencial,
    MINIMO_DE_CARACTERES,
    senhaConfere,
    SenhaInvalida
} from "./credencial.js";

const SENHA = "uma-senha-do-balcao";

function pastaTemporaria(): string {
    return mkdtempSync(join(tmpdir(), "salao-credencial-"));
}

describe("criar credencial", () => {
    it("aceita uma senha do tamanho mínimo", () => {
        const credencial = criarCredencial("x".repeat(MINIMO_DE_CARACTERES));
        assert.equal(credencial.versao, 1);
    });

    it("recusa senha curta demais", () => {
        assert.throws(() => criarCredencial("x".repeat(MINIMO_DE_CARACTERES - 1)), SenhaInvalida);
    });

    it("recusa senha vazia", () => {
        assert.throws(() => criarCredencial(""), SenhaInvalida);
    });

    it("não guarda a senha em lugar nenhum", () => {
        // O ponto do hash: quem abrir o arquivo não fica sabendo a senha, e
        // quase todo mundo repete senha entre sistemas.
        const credencial = criarCredencial(SENHA);
        assert.equal(JSON.stringify(credencial).includes(SENHA), false);
    });

    it("a mesma senha duas vezes dá hashes diferentes", () => {
        // Sal por credencial: sem isso, dois sistemas com a mesma senha teriam
        // o mesmo hash, e uma tabela pronta serviria para os dois.
        const a = criarCredencial(SENHA);
        const b = criarCredencial(SENHA);
        assert.notEqual(a.sal, b.sal);
        assert.notEqual(a.hash, b.hash);
    });
});

describe("conferir senha", () => {
    it("aceita a senha certa", () => {
        assert.equal(senhaConfere(SENHA, criarCredencial(SENHA)), true);
    });

    it("recusa a senha errada", () => {
        assert.equal(senhaConfere("outra-senha-qualquer", criarCredencial(SENHA)), false);
    });

    it("recusa senha vazia", () => {
        assert.equal(senhaConfere("", criarCredencial(SENHA)), false);
    });

    it("distingue maiúsculas", () => {
        assert.equal(senhaConfere(SENHA.toUpperCase(), criarCredencial(SENHA)), false);
    });

    it("recusa um prefixo da senha certa", () => {
        assert.equal(senhaConfere(SENHA.slice(0, -1), criarCredencial(SENHA)), false);
    });
});

describe("chave de sessão", () => {
    it("é estável para a mesma credencial", () => {
        const credencial = criarCredencial(SENHA);
        assert.deepEqual(chaveDeSessao(credencial), chaveDeSessao(credencial));
    });

    it("muda quando a senha muda — o que derruba as sessões abertas", () => {
        const antes = chaveDeSessao(criarCredencial(SENHA));
        const depois = chaveDeSessao(criarCredencial("uma-senha-nova-agora"));
        assert.notDeepEqual(antes, depois);
    });

    it("não é o hash cru", () => {
        const credencial = criarCredencial(SENHA);
        assert.notEqual(chaveDeSessao(credencial).toString("base64"), credencial.hash);
    });
});

describe("guardar e ler do disco", () => {
    it("o que foi gravado volta igual", () => {
        const pasta = pastaTemporaria();
        try {
            const caminho = join(pasta, "painel-senha.json");
            const credencial = criarCredencial(SENHA);
            gravarCredencial(caminho, credencial);

            const lida = lerCredencial(caminho);
            assert.deepEqual(lida, credencial);
            assert.ok(lida !== null);
            assert.equal(senhaConfere(SENHA, lida), true);
        } finally {
            rmSync(pasta, { recursive: true, force: true });
        }
    });

    it("arquivo que não existe é primeira abertura, não erro", () => {
        const pasta = pastaTemporaria();
        try {
            assert.equal(lerCredencial(join(pasta, "nao-existe.json")), null);
        } finally {
            rmSync(pasta, { recursive: true, force: true });
        }
    });

    it("arquivo corrompido também, em vez de derrubar o painel", () => {
        const pasta = pastaTemporaria();
        try {
            const caminho = join(pasta, "estragado.json");
            writeFileSync(caminho, "isto não é json");
            assert.equal(lerCredencial(caminho), null);
        } finally {
            rmSync(pasta, { recursive: true, force: true });
        }
    });

    it("json válido mas de outro formato é recusado", () => {
        const pasta = pastaTemporaria();
        try {
            const caminho = join(pasta, "outro.json");
            writeFileSync(caminho, JSON.stringify({ senha: "em texto puro" }));
            assert.equal(lerCredencial(caminho), null);
        } finally {
            rmSync(pasta, { recursive: true, force: true });
        }
    });

    it("versão desconhecida é recusada em vez de interpretada", () => {
        const pasta = pastaTemporaria();
        try {
            const caminho = join(pasta, "futura.json");
            writeFileSync(caminho, JSON.stringify({ versao: 99, sal: "a", hash: "b", criadaEm: "c" }));
            assert.equal(lerCredencial(caminho), null);
        } finally {
            rmSync(pasta, { recursive: true, force: true });
        }
    });

    it("gravar por cima troca a senha", () => {
        const pasta = pastaTemporaria();
        try {
            const caminho = join(pasta, "painel-senha.json");
            gravarCredencial(caminho, criarCredencial(SENHA));
            gravarCredencial(caminho, criarCredencial("agora-e-outra-senha"));

            const lida = lerCredencial(caminho);
            assert.ok(lida !== null);
            assert.equal(senhaConfere(SENHA, lida), false);
            assert.equal(senhaConfere("agora-e-outra-senha", lida), true);
        } finally {
            rmSync(pasta, { recursive: true, force: true });
        }
    });

    it("o arquivo gravado é JSON legível, para dar para inspecionar", () => {
        const pasta = pastaTemporaria();
        try {
            const caminho = join(pasta, "painel-senha.json");
            gravarCredencial(caminho, criarCredencial(SENHA));
            const texto = readFileSync(caminho, "utf8");

            assert.match(texto, /"versao": 1/u);
            assert.equal(texto.includes(SENHA), false, "a senha não pode estar no arquivo");
        } finally {
            rmSync(pasta, { recursive: true, force: true });
        }
    });
});
