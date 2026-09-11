import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it } from "node:test";
import { FalhaNoProvedor, NotificadorTwilio } from "./notificador-twilio.js";
import { paraE164 } from "./telefone-e164.js";
import type { AvisoDeMesaPronta } from "../../dominio/portas/notificador.js";

interface Recebida {
    metodo: string;
    caminho: string;
    autorizacao: string | undefined;
    tipoDeConteudo: string | undefined;
    campos: URLSearchParams;
}

interface ProvedorFalso {
    urlBase: string;
    recebidas: Recebida[];
    /** Define o que responder na próxima requisição. */
    responder(status: number, corpo: unknown): void;
    fechar(): Promise<void>;
}

/**
 * Servidor local que imita o recurso Message da Twilio. Sem credencial não dá
 * para chamar a Twilio de verdade, mas dá para verificar tudo o que o
 * adaptador controla: método, caminho, autenticação, formato do corpo e como
 * cada forma de falha é tratada.
 */
async function subirProvedorFalso(): Promise<ProvedorFalso> {
    const recebidas: Recebida[] = [];
    let proximoStatus = 201;
    let proximoCorpo: unknown = { sid: "SM123", status: "queued", error_code: null };

    const servidor: Server = createServer((requisicao, resposta) => {
        const pedacos: Buffer[] = [];
        requisicao.on("data", (p: Buffer) => pedacos.push(p));
        requisicao.on("end", () => {
            recebidas.push({
                metodo: requisicao.method ?? "",
                caminho: requisicao.url ?? "",
                autorizacao: requisicao.headers.authorization,
                tipoDeConteudo: requisicao.headers["content-type"],
                campos: new URLSearchParams(Buffer.concat(pedacos).toString("utf8"))
            });

            const texto = typeof proximoCorpo === "string" ? proximoCorpo : JSON.stringify(proximoCorpo);
            resposta.writeHead(proximoStatus, { "Content-Type": "application/json" });
            resposta.end(texto);
        });
    });

    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const { port } = servidor.address() as AddressInfo;

    return {
        urlBase: `http://127.0.0.1:${port}`,
        recebidas,
        responder: (status, corpo) => {
            proximoStatus = status;
            proximoCorpo = corpo;
        },
        fechar: () => new Promise<void>((resolve) => servidor.close(() => resolve()))
    };
}

const aviso: AvisoDeMesaPronta = {
    nome: "Helena",
    telefone: "11 98765-4321",
    mesaId: "m3",
    mesaNumero: 3
};

function criar(provedor: ProvedorFalso, canal?: "sms" | "whatsapp"): NotificadorTwilio {
    return new NotificadorTwilio({
        contaSid: "AC123",
        tokenDeAutenticacao: "token-secreto",
        remetente: "+15550001111",
        urlBase: provedor.urlBase,
        ...(canal === undefined ? {} : { canal })
    });
}

describe("paraE164", () => {
    it("completa o DDI quando o número vem sem ele", () => {
        assert.equal(paraE164("11 98765-4321", "55"), "+5511987654321");
    });

    it("não duplica o DDI já presente", () => {
        assert.equal(paraE164("+55 11 98765-4321", "55"), "+5511987654321");
        assert.equal(paraE164("5511987654321", "55"), "+5511987654321");
    });

    it("descarta separadores", () => {
        assert.equal(paraE164("(11) 98765-4321", "55"), "+5511987654321");
    });

    it("recusa telefone sem dígitos", () => {
        assert.throws(() => paraE164("sem numero", "55"), { name: "DadosInvalidos" });
    });

    it("recusa número longo ou curto demais para E.164", () => {
        assert.throws(() => paraE164("123", "55"), { name: "DadosInvalidos" });
        assert.throws(() => paraE164("1".repeat(20), "55"), { name: "DadosInvalidos" });
    });
});

describe("NotificadorTwilio", () => {
    it("exige credencial e remetente", () => {
        assert.throws(
            () => new NotificadorTwilio({ contaSid: "", tokenDeAutenticacao: "t", remetente: "+1" }),
            /contaSid e tokenDeAutenticacao/
        );
        assert.throws(
            () => new NotificadorTwilio({ contaSid: "AC", tokenDeAutenticacao: "t", remetente: "  " }),
            /remetente/
        );
    });

    it("envia POST form-urlencoded para o recurso Message, autenticado por Basic", async () => {
        const provedor = await subirProvedorFalso();
        try {
            await criar(provedor).mesaPronta(aviso);

            const pedido = provedor.recebidas[0];
            assert.ok(pedido);
            assert.equal(pedido.metodo, "POST");
            assert.equal(pedido.caminho, "/2010-04-01/Accounts/AC123/Messages.json");
            assert.equal(pedido.tipoDeConteudo, "application/x-www-form-urlencoded");

            const esperado = Buffer.from("AC123:token-secreto").toString("base64");
            assert.equal(pedido.autorizacao, `Basic ${esperado}`);
        } finally {
            await provedor.fechar();
        }
    });

    it("manda To normalizado, From e um corpo que nomeia cliente e mesa", async () => {
        const provedor = await subirProvedorFalso();
        try {
            await criar(provedor).mesaPronta(aviso);

            const campos = provedor.recebidas[0]?.campos;
            assert.ok(campos);
            assert.equal(campos.get("To"), "+5511987654321", "o telefone do salão virou E.164");
            assert.equal(campos.get("From"), "+15550001111");
            assert.match(campos.get("Body") ?? "", /Helena/);
            assert.match(campos.get("Body") ?? "", /mesa 3/i);
        } finally {
            await provedor.fechar();
        }
    });

    it("prefixa whatsapp: nos dois endereços quando o canal é WhatsApp", async () => {
        const provedor = await subirProvedorFalso();
        try {
            await criar(provedor, "whatsapp").mesaPronta(aviso);

            const campos = provedor.recebidas[0]?.campos;
            assert.equal(campos?.get("To"), "whatsapp:+5511987654321");
            assert.equal(campos?.get("From"), "whatsapp:+15550001111");
        } finally {
            await provedor.fechar();
        }
    });

    // A Twilio reporta as duas falhas de formas diferentes, e as duas importam.
    it("trata erro de HTTP preservando o código do provedor", async () => {
        const provedor = await subirProvedorFalso();
        try {
            provedor.responder(401, { code: 20003, message: "Authenticate", status: 401 });

            await assert.rejects(criar(provedor).mesaPronta(aviso), (erro: unknown) => {
                assert.ok(erro instanceof FalhaNoProvedor);
                assert.equal(erro.status, 401);
                assert.equal(erro.codigoDoProvedor, 20003);
                assert.match(erro.message, /Authenticate/);
                return true;
            });
        } finally {
            await provedor.fechar();
        }
    });

    it("trata requisição aceita com mensagem recusada (201 com error_code)", async () => {
        const provedor = await subirProvedorFalso();
        try {
            provedor.responder(201, {
                sid: "SM999",
                status: "failed",
                error_code: 21610,
                error_message: "Attempt to send to unsubscribed recipient"
            });

            await assert.rejects(criar(provedor).mesaPronta(aviso), (erro: unknown) => {
                assert.ok(erro instanceof FalhaNoProvedor);
                assert.equal(erro.codigoDoProvedor, 21610);
                assert.match(erro.message, /unsubscribed/);
                return true;
            });
        } finally {
            await provedor.fechar();
        }
    });

    it("não confunde error_code nulo com falha", async () => {
        const provedor = await subirProvedorFalso();
        try {
            provedor.responder(201, { sid: "SM1", status: "queued", error_code: null });
            await criar(provedor).mesaPronta(aviso);
        } finally {
            await provedor.fechar();
        }
    });

    it("falha com corpo que não é JSON quando o status já indica erro", async () => {
        const provedor = await subirProvedorFalso();
        try {
            provedor.responder(503, "<html>indisponível</html>");

            await assert.rejects(criar(provedor).mesaPronta(aviso), (erro: unknown) => {
                assert.ok(erro instanceof FalhaNoProvedor);
                assert.equal(erro.status, 503);
                assert.equal(erro.codigoDoProvedor, null);
                return true;
            });
        } finally {
            await provedor.fechar();
        }
    });

    it("recusa telefone que não forma E.164, sem chamar o provedor", async () => {
        const provedor = await subirProvedorFalso();
        try {
            await assert.rejects(criar(provedor).mesaPronta({ ...aviso, telefone: "123" }), {
                name: "DadosInvalidos"
            });
            assert.equal(provedor.recebidas.length, 0, "não gasta chamada com número inválido");
        } finally {
            await provedor.fechar();
        }
    });

    it("desiste quando o provedor não responde no tempo limite", async () => {
        const lento = createServer(() => {
            /* nunca responde */
        });
        await new Promise<void>((resolve) => lento.listen(0, "127.0.0.1", resolve));
        const { port } = lento.address() as AddressInfo;

        const notificador = new NotificadorTwilio({
            contaSid: "AC123",
            tokenDeAutenticacao: "t",
            remetente: "+15550001111",
            urlBase: `http://127.0.0.1:${port}`,
            tempoLimiteMs: 150
        });

        try {
            await assert.rejects(notificador.mesaPronta(aviso));
        } finally {
            await new Promise<void>((resolve) => {
                lento.closeAllConnections();
                lento.close(() => resolve());
            });
        }
    });
});
