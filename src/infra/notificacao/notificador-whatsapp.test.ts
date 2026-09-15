import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { EnvioDeWhatsAppFalhou, NotificadorWhatsApp, paraFormatoDaMeta } from "./notificador-whatsapp.js";

const AVISO = {
    nome: "Ana",
    telefone: "+5511999990001",
    mesaId: "m3",
    mesaNumero: 7
};

interface Pedido {
    url: string;
    opcoes: RequestInit;
}

/** Um `fetch` de mentira que guarda o que recebeu e devolve o que mandarmos. */
function espiao(resposta: { ok: boolean; status?: number; corpo?: string }) {
    const pedidos: Pedido[] = [];
    const buscar = (async (url: string | URL | Request, opcoes: RequestInit = {}) => {
        pedidos.push({ url: String(url), opcoes });
        return {
            ok: resposta.ok,
            status: resposta.status ?? (resposta.ok ? 200 : 400),
            text: async () => resposta.corpo ?? ""
        } as Response;
    }) as unknown as typeof fetch;

    return { pedidos, buscar };
}

function notificador(buscar: typeof fetch, extras: Record<string, unknown> = {}) {
    return new NotificadorWhatsApp({
        token: "token-de-teste",
        numeroRemetenteId: "123456",
        template: "mesa_pronta",
        idioma: "pt_BR",
        buscar,
        ...extras
    });
}

describe("telefone no formato da Meta", () => {
    it("tira o mais e deixa só dígitos", () => {
        assert.equal(paraFormatoDaMeta("+5511999990001"), "5511999990001");
    });

    it("tira espaços, hífens e parênteses", () => {
        assert.equal(paraFormatoDaMeta("+55 (11) 99999-0001"), "5511999990001");
    });

    it("deixa quieto o que já está só com dígitos", () => {
        assert.equal(paraFormatoDaMeta("5511999990001"), "5511999990001");
    });
});

describe("envio do aviso", () => {
    it("chama a URL da Meta com a versão e o número remetente", async () => {
        const { pedidos, buscar } = espiao({ ok: true });
        await notificador(buscar).mesaPronta(AVISO);

        assert.equal(pedidos.length, 1);
        assert.equal(pedidos[0]?.url, "https://graph.facebook.com/v21.0/123456/messages");
    });

    it("manda o token no cabeçalho", async () => {
        const { pedidos, buscar } = espiao({ ok: true });
        await notificador(buscar).mesaPronta(AVISO);

        const cabecalhos = pedidos[0]?.opcoes.headers as Record<string, string>;
        assert.equal(cabecalhos["Authorization"], "Bearer token-de-teste");
    });

    it("manda um template, e não texto livre", async () => {
        // Fora da janela de 24 h a Meta só aceita template. Mandar `text` faria
        // todo aviso ser recusado, e só se descobriria em produção.
        const { pedidos, buscar } = espiao({ ok: true });
        await notificador(buscar).mesaPronta(AVISO);

        const corpo = JSON.parse(String(pedidos[0]?.opcoes.body));
        assert.equal(corpo.type, "template");
        assert.equal(corpo.template.name, "mesa_pronta");
        assert.equal(corpo.template.language.code, "pt_BR");
    });

    it("manda o telefone sem o mais", async () => {
        const { pedidos, buscar } = espiao({ ok: true });
        await notificador(buscar).mesaPronta(AVISO);

        const corpo = JSON.parse(String(pedidos[0]?.opcoes.body));
        assert.equal(corpo.to, "5511999990001");
    });

    it("manda o número da mesa como parâmetro do template", async () => {
        const { pedidos, buscar } = espiao({ ok: true });
        await notificador(buscar).mesaPronta(AVISO);

        const corpo = JSON.parse(String(pedidos[0]?.opcoes.body));
        assert.deepEqual(corpo.template.components[0].parameters, [{ type: "text", text: "7" }]);
    });

    it("usa a versão da API que for pedida", async () => {
        const { pedidos, buscar } = espiao({ ok: true });
        await notificador(buscar, { versao: "v23.0" }).mesaPronta(AVISO);

        assert.match(String(pedidos[0]?.url), /\/v23\.0\//u);
    });
});

describe("quando a Meta recusa", () => {
    it("lança com o status e o motivo", async () => {
        const { buscar } = espiao({
            ok: false,
            status: 400,
            corpo: '{"error":{"message":"Template name does not exist"}}'
        });

        await assert.rejects(
            () => notificador(buscar).mesaPronta(AVISO),
            (erro: unknown) => {
                assert.ok(erro instanceof EnvioDeWhatsAppFalhou);
                assert.equal(erro.status, 400);
                assert.match(erro.detalhe, /Template name does not exist/u);
                return true;
            }
        );
    });

    it("o motivo entra na mensagem, que é o que vai para o log", async () => {
        const { buscar } = espiao({ ok: false, status: 401, corpo: "token vencido" });

        await assert.rejects(() => notificador(buscar).mesaPronta(AVISO), /HTTP 401.*token vencido/su);
    });

    it("corpo enorme não entope o log", async () => {
        const { buscar } = espiao({ ok: false, status: 500, corpo: "x".repeat(5000) });

        await assert.rejects(
            () => notificador(buscar).mesaPronta(AVISO),
            (erro: unknown) => {
                assert.ok(erro instanceof EnvioDeWhatsAppFalhou);
                assert.ok(erro.detalhe.length <= 500);
                return true;
            }
        );
    });

    it("rede fora vira erro, não silêncio", async () => {
        const buscar = (async () => {
            throw new TypeError("fetch failed");
        }) as unknown as typeof fetch;

        await assert.rejects(() => notificador(buscar).mesaPronta(AVISO), /fetch failed/u);
    });
});

describe("prazo", () => {
    it("manda um sinal de desistência, para não segurar o salão", async () => {
        const { pedidos, buscar } = espiao({ ok: true });
        await notificador(buscar).mesaPronta(AVISO);

        assert.ok(pedidos[0]?.opcoes.signal instanceof AbortSignal);
    });
});
