import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TravaAssincrona } from "./trava-assincrona.js";

const esperar = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("TravaAssincrona", () => {
    it("serializa tarefas da mesma chave, mesmo com await dentro", async () => {
        const trava = new TravaAssincrona();
        const eventos: string[] = [];

        await Promise.all([
            trava.executarComExclusividade("m1", async () => {
                eventos.push("A-entrou");
                await esperar(30);
                eventos.push("A-saiu");
            }),
            trava.executarComExclusividade("m1", async () => {
                eventos.push("B-entrou");
                await esperar(5);
                eventos.push("B-saiu");
            })
        ]);

        assert.deepEqual(eventos, ["A-entrou", "A-saiu", "B-entrou", "B-saiu"]);
    });

    it("permite que chaves distintas corram em paralelo", async () => {
        const trava = new TravaAssincrona();
        const inicio = Date.now();

        await Promise.all([
            trava.executarComExclusividade("x", () => esperar(40)),
            trava.executarComExclusividade("y", () => esperar(40))
        ]);

        assert.ok(Date.now() - inicio < 75, "as duas chaves deveriam ter corrido juntas");
    });

    it("libera a trava quando a tarefa lança exceção", async () => {
        const trava = new TravaAssincrona();

        await assert.rejects(
            trava.executarComExclusividade("k", () => {
                throw new Error("boom");
            }),
            /boom/
        );

        const resultado = await Promise.race([
            trava.executarComExclusividade("k", () => "passou"),
            esperar(100).then(() => "travado")
        ]);
        assert.equal(resultado, "passou");
    });

    it("devolve o valor da tarefa", async () => {
        const trava = new TravaAssincrona();
        assert.equal(await trava.executarComExclusividade("k", () => 42), 42);
        assert.equal(await trava.executarComExclusividade("k", async () => "ok"), "ok");
    });

    // Regressão: a comparação de limpeza mirava uma promise que nunca estava no
    // Map, então nenhuma entrada era removida e o Map crescia sem limite.
    it("não deixa entradas no Map depois de liberar", async () => {
        const trava = new TravaAssincrona();

        for (let i = 0; i < 500; i++) {
            await trava.executarComExclusividade(`chave-${i}`, () => i);
        }

        assert.equal(trava.chavesAtivas, 0);
    });

    it("mantém a entrada enquanto alguém ainda espera pela chave", async () => {
        const trava = new TravaAssincrona();
        let liberarPrimeira!: () => void;
        const portao = new Promise<void>((resolve) => {
            liberarPrimeira = resolve;
        });

        const primeira = trava.executarComExclusividade("m1", () => portao);
        const segunda = trava.executarComExclusividade("m1", () => "segunda");
        assert.equal(trava.chavesAtivas, 1, "a chave está em uso");

        liberarPrimeira();
        await Promise.all([primeira, segunda]);
        assert.equal(trava.chavesAtivas, 0, "depois que todos saíram, nada sobra");
    });
});
