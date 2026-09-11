import assert from "node:assert/strict";
import type { IncomingMessage } from "node:http";
import { describe, it } from "node:test";
import { autenticadorAberto, autenticadorPorToken } from "./autenticacao.js";

const requisicaoCom = (cabecalhos: Record<string, string>): IncomingMessage =>
    ({ headers: cabecalhos }) as unknown as IncomingMessage;

describe("autenticação por token", () => {
    const autenticador = autenticadorPorToken("segredo-da-equipe");

    it("aceita o token em Authorization: Bearer", () => {
        assert.equal(
            autenticador.permite(requisicaoCom({ authorization: "Bearer segredo-da-equipe" })),
            true
        );
    });

    it("aceita o token em X-API-Key", () => {
        assert.equal(autenticador.permite(requisicaoCom({ "x-api-key": "segredo-da-equipe" })), true);
    });

    it("recusa token errado", () => {
        assert.equal(autenticador.permite(requisicaoCom({ authorization: "Bearer outro" })), false);
    });

    it("recusa prefixo do token correto", () => {
        assert.equal(autenticador.permite(requisicaoCom({ authorization: "Bearer segredo" })), false);
    });

    it("recusa requisição sem credencial", () => {
        assert.equal(autenticador.permite(requisicaoCom({})), false);
    });

    it("recusa esquema que não é Bearer", () => {
        assert.equal(
            autenticador.permite(requisicaoCom({ authorization: "Basic segredo-da-equipe" })),
            false
        );
    });

    it("recusa criar autenticador com token vazio", () => {
        assert.throws(() => autenticadorPorToken("   "), /não pode ser vazio/);
    });

    it("o autenticador aberto deixa tudo passar", () => {
        assert.equal(autenticadorAberto.permite(requisicaoCom({})), true);
    });
});
