import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
    contagem,
    dataDoSeletor,
    dataPorExtenso,
    duracao,
    fimDoDia,
    fimDoDiaDe,
    horaMinuto,
    inicioDoDia,
    inicioDoDiaDe,
    segundosDesde
} from "./tempo.js";

/**
 * O único módulo do painel que faz conta de verdade, e o que o fechamento do
 * dia usa para saber onde o dia começa. Roda sob `node --test` como o resto da
 * suíte porque não toca em DOM nenhum — é aritmética de fuso, e aritmética se
 * testa sem navegador.
 *
 * São Paulo está em UTC−3 o ano inteiro desde 2019, então meia-noite no salão é
 * 03:00 UTC. As datas abaixo são escritas em UTC de propósito: se alguém rodar
 * a suíte noutro fuso, o resultado tem de ser o mesmo.
 */
describe("tempo do salão", () => {
    describe("duracao", () => {
        it("conta em segundos abaixo de um minuto", () => {
            assert.equal(duracao(0), "0 s");
            assert.equal(duracao(47), "47 s");
            assert.equal(duracao(59), "59 s");
        });

        it("conta em minutos até uma hora", () => {
            assert.equal(duracao(60), "1 min");
            assert.equal(duracao(3599), "59 min");
        });

        it("conta em horas daí em diante", () => {
            assert.equal(duracao(3600), "1h00");
            assert.equal(duracao(4320), "1h12");
            assert.equal(duracao(36000), "10h00");
        });

        it("trata tempo negativo como zero", () => {
            assert.equal(duracao(-5), "0 s", "relógio do aparelho atrasado não vira número negativo");
        });
    });

    describe("contagem", () => {
        it("formata como relógio", () => {
            assert.equal(contagem(0), "0:00");
            assert.equal(contagem(64), "1:04");
            assert.equal(contagem(600), "10:00");
        });

        it("não conta para trás", () => {
            assert.equal(contagem(-30), "0:00");
        });
    });

    describe("hora e data no fuso do salão", () => {
        it("converte de UTC para o horário de São Paulo", () => {
            assert.equal(horaMinuto(new Date("2026-09-14T14:08:00Z")), "11:08");
        });

        it("atravessa a meia-noite para o dia anterior", () => {
            const instante = new Date("2026-09-14T02:30:00Z");
            assert.equal(horaMinuto(instante), "23:30", "02:30 UTC ainda é dia 13 no salão");
            assert.match(dataPorExtenso(instante), /13 de setembro/u);
        });

        it("dataDoSeletor devolve o dia do salão, não o dia UTC", () => {
            assert.equal(dataDoSeletor(new Date("2026-09-14T02:30:00Z")), "2026-09-13");
            assert.equal(dataDoSeletor(new Date("2026-09-14T14:00:00Z")), "2026-09-14");
        });
    });

    describe("bordas do dia", () => {
        it("o dia começa às 03:00 UTC", () => {
            const dentro = new Date("2026-09-14T14:00:00Z");
            assert.equal(inicioDoDia(dentro).toISOString(), "2026-09-14T03:00:00.000Z");
            assert.equal(fimDoDia(dentro).toISOString(), "2026-09-15T03:00:00.000Z");
        });

        it("um instante logo depois da meia-noite do salão pertence ao dia novo", () => {
            // 03:10 UTC é 00:10 no salão: já é dia 14.
            assert.equal(
                inicioDoDia(new Date("2026-09-14T03:10:00Z")).toISOString(),
                "2026-09-14T03:00:00.000Z"
            );
        });

        it("um instante logo antes dela ainda pertence ao dia anterior", () => {
            // 02:50 UTC é 23:50 do dia 13.
            assert.equal(
                inicioDoDia(new Date("2026-09-14T02:50:00Z")).toISOString(),
                "2026-09-13T03:00:00.000Z"
            );
        });

        it("o dia dura 24 horas", () => {
            const comeco = inicioDoDia(new Date("2026-09-14T14:00:00Z"));
            const fim = fimDoDia(new Date("2026-09-14T14:00:00Z"));
            assert.equal(fim.getTime() - comeco.getTime(), 24 * 60 * 60 * 1000);
        });
    });

    describe("data vinda do seletor", () => {
        it("lê AAAA-MM-DD no fuso do salão, não em UTC", () => {
            assert.equal(inicioDoDiaDe("2026-09-14")?.toISOString(), "2026-09-14T03:00:00.000Z");
            assert.equal(fimDoDiaDe("2026-09-14")?.toISOString(), "2026-09-15T03:00:00.000Z");
        });

        it("casa de ida e volta com dataDoSeletor", () => {
            const agora = new Date("2026-09-14T02:30:00Z");
            const texto = dataDoSeletor(agora);
            assert.equal(inicioDoDiaDe(texto)?.getTime(), inicioDoDia(agora).getTime());
        });

        it("recusa o que não é data", () => {
            for (const bruto of ["", "14/09/2026", "2026-9-4", "ontem", "2026-09-14T00:00:00Z"]) {
                assert.equal(inicioDoDiaDe(bruto), null, `"${bruto}" não é data do seletor`);
            }
        });

        it("recusa data que não existe em vez de rolar o mês", () => {
            assert.equal(inicioDoDiaDe("2026-02-31"), null, "Date.UTC rolaria para março");
            assert.equal(inicioDoDiaDe("2026-13-01"), null);
            assert.equal(inicioDoDiaDe("2026-00-10"), null);
        });

        it("aceita 29 de fevereiro em ano bissexto", () => {
            assert.equal(inicioDoDiaDe("2028-02-29")?.toISOString(), "2028-02-29T03:00:00.000Z");
            assert.equal(inicioDoDiaDe("2026-02-29"), null, "2026 não é bissexto");
        });
    });

    describe("segundosDesde", () => {
        it("conta do instante ISO até agora", () => {
            const agora = new Date("2026-09-14T14:08:00Z");
            assert.equal(segundosDesde("2026-09-14T14:07:00Z", agora), 60);
        });

        it("não conta para trás quando o instante está no futuro", () => {
            const agora = new Date("2026-09-14T14:08:00Z");
            assert.equal(segundosDesde("2026-09-14T14:09:00Z", agora), 0);
        });
    });
});
