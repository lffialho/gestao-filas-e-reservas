import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
    cabecalhoDoCookie,
    cabecalhoParaSair,
    criarSessao,
    DURACAO_EM_HORAS,
    iguaisEmTempoConstante,
    lerCookie,
    NOME_DO_COOKIE,
    sessaoValida
} from "./sessao.js";

const SENHA = "senha-do-balcao";
const AGORA = new Date("2026-09-14T20:00:00.000Z");
const depois = (horas: number) => new Date(AGORA.getTime() + horas * 60 * 60 * 1000);

describe("sessão do painel", () => {
    it("aceita a sessão que ela mesma criou", () => {
        assert.equal(sessaoValida(criarSessao(SENHA, AGORA), SENHA, AGORA), true);
    });

    it("recusa quando não há cookie nenhum", () => {
        assert.equal(sessaoValida(null, SENHA, AGORA), false);
    });

    it("recusa lixo que não tem a forma de uma sessão", () => {
        for (const valor of ["", ".", "sem-ponto", ".sóassinatura", "1780000000000."]) {
            assert.equal(sessaoValida(valor, SENHA, AGORA), false, `aceitou "${valor}"`);
        }
    });

    it("recusa a sessão de outra senha", () => {
        const deOutro = criarSessao("outra-senha", AGORA);
        assert.equal(sessaoValida(deOutro, SENHA, AGORA), false);
    });

    it("trocar a senha invalida as sessões abertas", () => {
        const antes = criarSessao(SENHA, AGORA);
        assert.equal(sessaoValida(antes, "senha-nova", AGORA), false);
    });

    it("recusa prazo esticado sem assinatura nova", () => {
        // O ataque óbvio: pegar o cookie e aumentar o número antes do ponto.
        const valida = criarSessao(SENHA, AGORA);
        const assinatura = valida.slice(valida.indexOf(".") + 1);
        const esticada = `${AGORA.getTime() + 10 * 365 * 24 * 60 * 60 * 1000}.${assinatura}`;
        assert.equal(sessaoValida(esticada, SENHA, AGORA), false);
    });

    it("vale durante o turno e caduca depois", () => {
        const sessao = criarSessao(SENHA, AGORA);
        assert.equal(sessaoValida(sessao, SENHA, depois(DURACAO_EM_HORAS - 1)), true);
        assert.equal(sessaoValida(sessao, SENHA, depois(DURACAO_EM_HORAS + 1)), false);
    });

    it("sobrevive ao painel reiniciar", () => {
        // A chave sai da senha, não de um segredo sorteado ao subir: quem estava
        // logado continua logado depois de o Agendador levantar o painel de novo.
        const antesDaQueda = criarSessao(SENHA, AGORA);
        assert.equal(sessaoValida(antesDaQueda, SENHA, depois(1)), true);
    });
});

describe("leitura de cookie", () => {
    it("acha o cookie entre outros", () => {
        const cabecalho = `tema=escuro; ${NOME_DO_COOKIE}=abc123; idioma=pt`;
        assert.equal(lerCookie(cabecalho, NOME_DO_COOKIE), "abc123");
    });

    it("devolve null quando não há cabeçalho", () => {
        assert.equal(lerCookie(undefined, NOME_DO_COOKIE), null);
    });

    it("devolve null quando o cookie não está lá", () => {
        assert.equal(lerCookie("tema=escuro", NOME_DO_COOKIE), null);
    });

    it("não confunde um cookie cujo nome termina igual", () => {
        assert.equal(lerCookie(`nao_e_${NOME_DO_COOKIE}=xis`, NOME_DO_COOKIE), null);
    });

    it("decodifica o valor", () => {
        assert.equal(lerCookie(`${NOME_DO_COOKIE}=a%2Eb`, NOME_DO_COOKIE), "a.b");
    });

    it("casa de ida e volta com o cabeçalho que emitimos", () => {
        const sessao = criarSessao(SENHA, AGORA);
        const emitido = cabecalhoDoCookie(sessao, 3600);
        const valor = emitido.slice(0, emitido.indexOf(";"));
        assert.equal(lerCookie(valor, NOME_DO_COOKIE), sessao);
    });
});

describe("cabeçalho do cookie", () => {
    it("é HttpOnly e SameSite=Strict", () => {
        const cabecalho = cabecalhoDoCookie("qualquer", 3600);
        assert.match(cabecalho, /HttpOnly/u);
        assert.match(cabecalho, /SameSite=Strict/u);
    });

    it("sair apaga o cookie", () => {
        assert.match(cabecalhoParaSair(), /Max-Age=0/u);
    });
});

describe("comparação em tempo constante", () => {
    it("diz sim para iguais e não para diferentes", () => {
        assert.equal(iguaisEmTempoConstante("abc", "abc"), true);
        assert.equal(iguaisEmTempoConstante("abc", "abd"), false);
    });

    it("não estoura com tamanhos diferentes", () => {
        assert.equal(iguaisEmTempoConstante("abc", "abcdef"), false);
        assert.equal(iguaisEmTempoConstante("", "x"), false);
    });
});
