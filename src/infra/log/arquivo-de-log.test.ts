import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { criarEscritorDeArquivo, PastaDeLogInexistente } from "./arquivo-de-log.js";

const pastas: string[] = [];

function pastaNova(): string {
    const pasta = mkdtempSync(join(tmpdir(), "log-do-salao-"));
    pastas.push(pasta);
    return pasta;
}

after(() => {
    for (const pasta of pastas) {
        try {
            rmSync(pasta, { recursive: true, force: true, maxRetries: 3 });
        } catch {
            // deixar pasta temporária para trás não falha o teste
        }
    }
});

const linhas = (caminho: string): string[] => readFileSync(caminho, "utf8").split("\n").filter(Boolean);

describe("log em arquivo", () => {
    it("escreve uma linha por evento", () => {
        const caminho = join(pastaNova(), "salao.log");
        const escrever = criarEscritorDeArquivo({ caminho });

        escrever('{"evento":"um"}', "info");
        escrever('{"evento":"dois"}', "info");

        assert.deepEqual(linhas(caminho), ['{"evento":"um"}', '{"evento":"dois"}']);
    });

    it("continua de onde parou quando o serviço reinicia", () => {
        // O Agendador levanta o processo de novo a cada pane: recomeçar o
        // arquivo apagaria justamente o log da queda que se quer investigar.
        const caminho = join(pastaNova(), "salao.log");

        criarEscritorDeArquivo({ caminho })('{"evento":"antes"}', "info");
        criarEscritorDeArquivo({ caminho })('{"evento":"depois"}', "info");

        assert.deepEqual(linhas(caminho), ['{"evento":"antes"}', '{"evento":"depois"}']);
    });

    it("recusa pasta que não existe, em vez de criá-la num canto qualquer", () => {
        const caminho = join(pastaNova(), "nao", "existe", "salao.log");
        assert.throws(() => criarEscritorDeArquivo({ caminho }), PastaDeLogInexistente);
    });
});

describe("rodízio", () => {
    it("roda o arquivo ao passar do tamanho", () => {
        const pasta = pastaNova();
        const caminho = join(pasta, "salao.log");
        const escrever = criarEscritorDeArquivo({ caminho, tamanhoMaximoEmBytes: 60 });

        for (let i = 0; i < 6; i += 1) {
            escrever(`{"evento":"linha-${i}-com-algum-tamanho"}`, "info");
        }

        assert.ok(existsSync(`${caminho}.1`), "devia ter deixado um anterior");
    });

    it("o mais recente fica no arquivo sem número", () => {
        const pasta = pastaNova();
        const caminho = join(pasta, "salao.log");
        const escrever = criarEscritorDeArquivo({ caminho, tamanhoMaximoEmBytes: 60 });

        for (let i = 0; i < 6; i += 1) {
            escrever(`{"evento":"linha-${i}-com-algum-tamanho"}`, "info");
        }

        const atual = readFileSync(caminho, "utf8");
        assert.match(atual, /linha-5/u, "a última linha tinha de estar no arquivo atual");
    });

    it("guarda só o número de cópias pedido", () => {
        const pasta = pastaNova();
        const caminho = join(pasta, "salao.log");
        const escrever = criarEscritorDeArquivo({ caminho, tamanhoMaximoEmBytes: 40, copias: 2 });

        for (let i = 0; i < 20; i += 1) {
            escrever(`{"evento":"enchendo-o-arquivo-${i}"}`, "info");
        }

        assert.ok(existsSync(`${caminho}.1`));
        assert.ok(existsSync(`${caminho}.2`));
        assert.equal(existsSync(`${caminho}.3`), false, "log sem limite enche o disco do balcão");
    });

    it("nada se perde entre o arquivo atual e o anterior", () => {
        const pasta = pastaNova();
        const caminho = join(pasta, "salao.log");
        const escrever = criarEscritorDeArquivo({ caminho, tamanhoMaximoEmBytes: 80, copias: 3 });

        for (let i = 0; i < 5; i += 1) {
            escrever(`{"i":${i}}`, "info");
        }

        const tudo = [`${caminho}.3`, `${caminho}.2`, `${caminho}.1`, caminho]
            .filter((c) => existsSync(c))
            .flatMap((c) => linhas(c))
            .join(" ");

        for (let i = 0; i < 5; i += 1) {
            assert.match(tudo, new RegExp(`"i":${i}`, "u"), `sumiu a linha ${i}`);
        }
    });
});

describe("falha ao escrever não derruba o serviço", () => {
    it("pasta apagada debaixo do escritor não lança", () => {
        const pasta = pastaNova();
        const caminho = join(pasta, "salao.log");
        const escrever = criarEscritorDeArquivo({ caminho });

        escrever('{"evento":"antes"}', "info");
        rmSync(pasta, { recursive: true, force: true });

        assert.doesNotThrow(() => escrever('{"evento":"depois"}', "info"));
    });
});
