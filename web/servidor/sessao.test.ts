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

// A sessão não conhece senha: recebe a chave já derivada. Chaves fixas aqui
// deixam o teste independente de como a credencial as deriva.
const CHAVE = Buffer.from("chave-de-um-salao-para-teste-123".padEnd(32, "."));
const OUTRA_CHAVE = Buffer.from("chave-de-outro-salao-diferente-x".padEnd(32, "."));
const AGORA = new Date("2026-09-14T20:00:00.000Z");
const depois = (horas: number) => new Date(AGORA.getTime() + horas * 60 * 60 * 1000);

describe("sessão do painel", () => {
    it("aceita a sessão que ela mesma criou", () => {
        assert.equal(sessaoValida(criarSessao(CHAVE, AGORA), CHAVE, AGORA), true);
    });

    it("recusa quando não há cookie nenhum", () => {
        assert.equal(sessaoValida(null, CHAVE, AGORA), false);
    });

    it("recusa lixo que não tem a forma de uma sessão", () => {
        for (const valor of ["", ".", "sem-ponto", ".sóassinatura", "1780000000000."]) {
            assert.equal(sessaoValida(valor, CHAVE, AGORA), false, `aceitou "${valor}"`);
        }
    });

    it("recusa a sessão assinada por outra chave", () => {
        const deOutro = criarSessao(OUTRA_CHAVE, AGORA);
        assert.equal(sessaoValida(deOutro, CHAVE, AGORA), false);
    });

    it("trocar a senha invalida as sessões abertas", () => {
        // Trocar a senha troca o hash, que troca a chave: o cookie de antes
        // deixa de valer, que é o que se espera ao trocar uma senha.
        const antes = criarSessao(CHAVE, AGORA);
        assert.equal(sessaoValida(antes, OUTRA_CHAVE, AGORA), false);
    });

    it("recusa prazo esticado sem assinatura nova", () => {
        // O ataque óbvio: pegar o cookie e aumentar o número antes do ponto.
        const valida = criarSessao(CHAVE, AGORA);
        const assinatura = valida.slice(valida.indexOf(".") + 1);
        const esticada = `${AGORA.getTime() + 10 * 365 * 24 * 60 * 60 * 1000}.${assinatura}`;
        assert.equal(sessaoValida(esticada, CHAVE, AGORA), false);
    });

    it("vale durante o turno e caduca depois", () => {
        const sessao = criarSessao(CHAVE, AGORA);
        assert.equal(sessaoValida(sessao, CHAVE, depois(DURACAO_EM_HORAS - 1)), true);
        assert.equal(sessaoValida(sessao, CHAVE, depois(DURACAO_EM_HORAS + 1)), false);
    });

    it("sobrevive ao painel reiniciar", () => {
        // A chave sai do hash da senha, não de um segredo sorteado: quem estava
        // logado continua logado depois de o Agendador levantar o painel de novo.
        const antesDaQueda = criarSessao(CHAVE, AGORA);
        assert.equal(sessaoValida(antesDaQueda, CHAVE, depois(1)), true);
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
        const sessao = criarSessao(CHAVE, AGORA);
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
