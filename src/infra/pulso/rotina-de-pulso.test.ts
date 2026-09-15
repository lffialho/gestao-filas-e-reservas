import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Relogio } from "../../compartilhado/tempo/relogio.js";
import { RotinaDePulso } from "./rotina-de-pulso.js";

const relogioFixo: Relogio = { agora: () => new Date("2026-09-14T20:00:00.000Z") };

interface Pedido {
    url: string;
    opcoes: RequestInit;
}

function espiao(resposta: { ok: boolean; status?: number } | Error) {
    const pedidos: Pedido[] = [];
    const buscar = (async (url: string | URL | Request, opcoes: RequestInit = {}) => {
        pedidos.push({ url: String(url), opcoes });
        if (resposta instanceof Error) {
            throw resposta;
        }
        return { ok: resposta.ok, status: resposta.status ?? (resposta.ok ? 200 : 500) } as Response;
    }) as unknown as typeof fetch;

    return { pedidos, buscar };
}

function corpoDe(pedido: Pedido | undefined): Record<string, unknown> {
    return JSON.parse(String(pedido?.opcoes.body)) as Record<string, unknown>;
}

describe("pulso: a casa avisando que está funcionando", () => {
    it("manda POST para a URL configurada", async () => {
        const { pedidos, buscar } = espiao({ ok: true });
        await new RotinaDePulso({
            url: "https://monitor.exemplo/abc",
            aCadaMinutos: 5,
            buscar,
            relogio: relogioFixo
        }).agora();

        assert.equal(pedidos.length, 1);
        assert.equal(pedidos[0]?.url, "https://monitor.exemplo/abc");
        assert.equal(pedidos[0]?.opcoes.method, "POST");
    });

    it("diz qual casa é, para quem recebe distinguir", async () => {
        const { pedidos, buscar } = espiao({ ok: true });
        await new RotinaDePulso({
            url: "https://monitor.exemplo/abc",
            aCadaMinutos: 5,
            casa: "cantina-do-ze",
            buscar,
            relogio: relogioFixo
        }).agora();

        assert.equal(corpoDe(pedidos[0])["casa"], "cantina-do-ze");
    });

    it("carrega o momento, que é o que o monitor compara", async () => {
        const { pedidos, buscar } = espiao({ ok: true });
        await new RotinaDePulso({
            url: "https://monitor.exemplo/abc",
            aCadaMinutos: 5,
            buscar,
            relogio: relogioFixo
        }).agora();

        assert.equal(corpoDe(pedidos[0])["momento"], "2026-09-14T20:00:00.000Z");
    });

    it("leva o resumo que lhe derem", async () => {
        const { pedidos, buscar } = espiao({ ok: true });
        await new RotinaDePulso({
            url: "https://monitor.exemplo/abc",
            aCadaMinutos: 5,
            resumo: () => ({ mesas: 6, ocupadas: 2, fila: 3 }),
            buscar,
            relogio: relogioFixo
        }).agora();

        const corpo = corpoDe(pedidos[0]);
        assert.equal(corpo["mesas"], 6);
        assert.equal(corpo["fila"], 3);
    });

    it("manda um sinal de desistência, para rede ruim não empilhar pulsos", async () => {
        const { pedidos, buscar } = espiao({ ok: true });
        await new RotinaDePulso({ url: "https://m.exemplo", aCadaMinutos: 5, buscar }).agora();

        assert.ok(pedidos[0]?.opcoes.signal instanceof AbortSignal);
    });
});

describe("nada de dado pessoal sai da casa", () => {
    it("o corpo só tem o que foi posto nele", async () => {
        // A trava que importa: quem recebe o pulso é um terceiro. Nome e
        // telefone de quem jantou ali não podem atravessar por descuido de
        // quem um dia acrescentar um campo ao resumo.
        const { pedidos, buscar } = espiao({ ok: true });
        await new RotinaDePulso({
            url: "https://monitor.exemplo/abc",
            aCadaMinutos: 5,
            casa: "cantina",
            resumo: () => ({ mesas: 6, ocupadas: 2, fila: 3 }),
            buscar,
            relogio: relogioFixo
        }).agora();

        assert.deepEqual(Object.keys(corpoDe(pedidos[0])).sort(), [
            "casa",
            "fila",
            "mesas",
            "momento",
            "ocupadas"
        ]);
    });

    it("sem resumo, sai só casa e momento", async () => {
        const { pedidos, buscar } = espiao({ ok: true });
        await new RotinaDePulso({
            url: "https://m.exemplo",
            aCadaMinutos: 5,
            buscar,
            relogio: relogioFixo
        }).agora();

        assert.deepEqual(Object.keys(corpoDe(pedidos[0])).sort(), ["casa", "momento"]);
    });
});

describe("quando o pulso não chega", () => {
    it("rede fora não lança — o salão continua atendendo", async () => {
        const { buscar } = espiao(new TypeError("fetch failed"));
        const rotina = new RotinaDePulso({ url: "https://m.exemplo", aCadaMinutos: 5, buscar });

        assert.equal(await rotina.agora(), false);
    });

    it("destino respondendo erro também conta como falha", async () => {
        const { buscar } = espiao({ ok: false, status: 502 });
        const rotina = new RotinaDePulso({ url: "https://m.exemplo", aCadaMinutos: 5, buscar });

        assert.equal(await rotina.agora(), false);
        assert.match(String(rotina.estado().ultimaFalha), /502/u);
    });

    it("conta as falhas seguidas", async () => {
        const { buscar } = espiao(new Error("sem rede"));
        const rotina = new RotinaDePulso({ url: "https://m.exemplo", aCadaMinutos: 5, buscar });

        await rotina.agora();
        await rotina.agora();
        await rotina.agora();

        assert.equal(rotina.estado().falhasSeguidas, 3);
        assert.equal(rotina.estado().ultimoEnvioEm, null);
    });

    it("um sucesso zera a contagem", async () => {
        let vaiFalhar = true;
        const buscar = (async () => {
            if (vaiFalhar) {
                throw new Error("sem rede");
            }
            return { ok: true, status: 200 } as Response;
        }) as unknown as typeof fetch;

        const rotina = new RotinaDePulso({
            url: "https://m.exemplo",
            aCadaMinutos: 5,
            buscar,
            relogio: relogioFixo
        });

        await rotina.agora();
        assert.equal(rotina.estado().falhasSeguidas, 1);

        vaiFalhar = false;
        await rotina.agora();

        assert.equal(rotina.estado().falhasSeguidas, 0);
        assert.equal(rotina.estado().ultimaFalha, null);
        assert.equal(rotina.estado().ultimoEnvioEm, "2026-09-14T20:00:00.000Z");
    });
});

describe("estado", () => {
    it("começa sem nenhum envio", () => {
        const estado = new RotinaDePulso({ url: "https://m.exemplo", aCadaMinutos: 5 }).estado();

        assert.equal(estado.ultimoEnvioEm, null);
        assert.equal(estado.ultimaFalha, null);
        assert.equal(estado.falhasSeguidas, 0);
    });

    it("parar antes de iniciar não estoura", () => {
        const rotina = new RotinaDePulso({ url: "https://m.exemplo", aCadaMinutos: 5 });
        assert.doesNotThrow(() => rotina.parar());
    });
});
