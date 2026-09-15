import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";
import type { Relogio } from "../../compartilhado/tempo/relogio.js";
import { Mesa } from "../../dominio/entidades/mesa.js";
import { Cliente } from "../../dominio/entidades/cliente.js";
import { RepositorioDoSalaoSqlite } from "../sqlite/repositorio-do-salao-sqlite.js";
import { nomeDaCopia, RotinaDeBackup } from "./rotina-de-backup.js";

class RelogioFalso implements Relogio {
    #instante: number;

    constructor(inicio: string) {
        this.#instante = new Date(inicio).getTime();
    }

    agora(): Date {
        return new Date(this.#instante);
    }

    avancarMinutos(minutos: number): void {
        this.#instante += minutos * 60_000;
    }
}

const pastas: string[] = [];

function pastaNova(): string {
    const pasta = mkdtempSync(join(tmpdir(), "backup-"));
    pastas.push(pasta);
    return pasta;
}

after(() => {
    for (const pasta of pastas) {
        // Windows segura arquivo recém-fechado por um instante; melhor esforço.
        try {
            rmSync(pasta, { recursive: true, force: true, maxRetries: 3 });
        } catch {
            // deixar a pasta temporária para trás não falha o teste
        }
    }
});

describe("RotinaDeBackup", () => {
    it("o nome carrega a data e serve no Windows", () => {
        const nome = nomeDaCopia(new Date("2026-09-14T18:07:32.306Z"));

        assert.equal(nome, "salao-2026-09-14T18-07-32-306Z.db");
        assert.ok(!nome.includes(":"), "dois-pontos não vale em nome de arquivo no Windows");
    });

    it("os nomes ordenam em texto na mesma ordem do tempo", () => {
        const cedo = nomeDaCopia(new Date("2026-09-14T09:00:00Z"));
        const tarde = nomeDaCopia(new Date("2026-09-14T21:00:00Z"));
        const amanha = nomeDaCopia(new Date("2026-09-15T01:00:00Z"));

        assert.deepEqual([amanha, tarde, cedo].sort(), [cedo, tarde, amanha]);
    });

    it("grava a primeira cópia ao iniciar e cria a pasta", () => {
        const pasta = join(pastaNova(), "copias");
        const rotina = new RotinaDeBackup((destino) => writeFileSync(destino, "banco"), {
            pasta,
            aCadaHoras: 6,
            copias: 3
        });

        rotina.iniciar();
        rotina.parar();

        assert.equal(readdirSync(pasta).length, 1, "a pasta é criada e já sai com uma cópia");
    });

    it("guarda só o número de cópias pedido, apagando as mais antigas", () => {
        const pasta = pastaNova();
        const relogio = new RelogioFalso("2026-09-14T00:00:00Z");
        const rotina = new RotinaDeBackup((destino) => writeFileSync(destino, "banco"), {
            pasta,
            aCadaHoras: 6,
            copias: 3,
            relogio
        });

        for (let i = 0; i < 5; i++) {
            rotina.agora();
            relogio.avancarMinutos(60);
        }

        const restantes = readdirSync(pasta).sort();
        assert.equal(restantes.length, 3);
        assert.deepEqual(
            restantes,
            [
                "salao-2026-09-14T02-00-00-000Z.db",
                "salao-2026-09-14T03-00-00-000Z.db",
                "salao-2026-09-14T04-00-00-000Z.db"
            ],
            "sobram as três mais novas"
        );
    });

    /**
     * O salão tem de continuar atendendo mesmo que a pasta das cópias tenha
     * sumido ou virado somente-leitura. Backup que derruba o serviço troca um
     * risco por um pior.
     */
    it("não lança quando a cópia falha", () => {
        const pasta = pastaNova();
        const rotina = new RotinaDeBackup(
            () => {
                throw new Error("disco cheio");
            },
            { pasta, aCadaHoras: 6, copias: 3 }
        );

        assert.doesNotThrow(() => rotina.iniciar());
        assert.equal(rotina.agora(), null, "diz que não conseguiu, em vez de fingir");
        rotina.parar();
    });

    /**
     * A prova que importa: a cópia é tirada com o serviço de pé e o arquivo
     * resultante abre e tem o estado do momento em que foi tirada.
     */
    it("copia um banco vivo e a cópia abre com o estado daquele instante", () => {
        const pasta = pastaNova();
        const banco = join(pasta, "salao.db");
        const repositorio = new RepositorioDoSalaoSqlite(banco, {
            mesas: [new Mesa("m1", 1, 2), new Mesa("m2", 2, 4)]
        });

        repositorio.transacao((salao) => salao.receberCliente(new Cliente("Ana", 2, "1111")));

        const rotina = new RotinaDeBackup((destino) => repositorio.copiarPara(destino), {
            pasta: join(pasta, "copias"),
            aCadaHoras: 6,
            copias: 5
        });
        const copia = rotina.agora();
        assert.ok(copia !== null && existsSync(copia), "a cópia existe");

        // O salão segue mudando depois da cópia: ela é um retrato, não um espelho.
        repositorio.transacao((salao) => salao.receberCliente(new Cliente("Bruno", 4, "2222")));

        const lida = new DatabaseSync(copia as string, { readOnly: true });
        const ocupadas = lida.prepare("SELECT cliente_nome FROM mesas WHERE cliente_nome IS NOT NULL").all();
        lida.close();
        repositorio.fechar();

        assert.deepEqual(
            ocupadas.map((linha) => (linha as { cliente_nome: string }).cliente_nome),
            ["Ana"],
            "a cópia tem quem estava lá no instante em que foi tirada, e não quem chegou depois"
        );
    });

    it("recusa sobrescrever uma cópia que já existe", () => {
        const pasta = pastaNova();
        const banco = join(pasta, "salao.db");
        const repositorio = new RepositorioDoSalaoSqlite(banco, { mesas: [new Mesa("m1", 1, 2)] });
        const destino = join(pasta, "copia.db");

        repositorio.copiarPara(destino);
        assert.throws(
            () => repositorio.copiarPara(destino),
            "backup que apaga o backup anterior não é backup"
        );
        repositorio.fechar();
    });
});

describe("espelho: a cópia que sai deste disco", () => {
    /** Copiador de mentira: escreve um arquivo qualquer no destino. */
    const escrever = (destino: string) => writeFileSync(destino, "conteudo");

    it("põe cada cópia também na segunda pasta", () => {
        const pasta = pastaNova();
        const espelho = pastaNova();
        const relogio = new RelogioFalso("2026-09-14T20:00:00.000Z");

        const rotina = new RotinaDeBackup(escrever, { pasta, espelho, aCadaHoras: 6, copias: 5, relogio });
        const destino = rotina.agora();

        assert.ok(destino !== null);
        const nome = nomeDaCopia(new Date("2026-09-14T20:00:00.000Z"));
        assert.ok(existsSync(join(pasta, nome)), "faltou a cópia local");
        assert.ok(existsSync(join(espelho, nome)), "faltou a cópia no espelho");
    });

    it("cria a pasta do espelho dentro de uma que já existe", () => {
        const pasta = pastaNova();
        const espelho = join(pastaNova(), "copias-do-salao");
        const relogio = new RelogioFalso("2026-09-14T20:00:00.000Z");

        new RotinaDeBackup(escrever, { pasta, espelho, aCadaHoras: 6, copias: 5, relogio }).agora();
        assert.equal(readdirSync(espelho).length, 1);
    });

    it("recusa espelho cuja pasta de cima não existe, em vez de inventá-la", () => {
        // O caso que motivou isto: um caminho no formato de outro sistema
        // (`/c/Users/...`) o Windows resolve a partir da raiz do disco. Com
        // criação recursiva, a árvore inteira nascia ali e a cópia "dava certo"
        // — e o dono seguia achando que tinha backup no OneDrive.
        const pasta = pastaNova();
        const espelho = join(pastaNova(), "nao", "existe", "aqui");
        const relogio = new RelogioFalso("2026-09-14T20:00:00.000Z");

        const rotina = new RotinaDeBackup(escrever, { pasta, espelho, aCadaHoras: 6, copias: 5, relogio });
        const destino = rotina.agora();

        assert.ok(destino !== null, "a cópia local tinha de ter saído assim mesmo");
        assert.equal(existsSync(espelho), false, "não podia ter criado a árvore");

        const estado = rotina.estado();
        assert.equal(estado.espelho?.ultimaCopiaEm, null);
        assert.match(String(estado.espelho?.ultimaFalha), /não existe/u);
    });

    it("a segunda cópia não tropeça na pasta que a primeira criou", () => {
        const pasta = pastaNova();
        const espelho = join(pastaNova(), "copias-do-salao");
        const relogio = new RelogioFalso("2026-09-14T20:00:00.000Z");
        const rotina = new RotinaDeBackup(escrever, { pasta, espelho, aCadaHoras: 6, copias: 5, relogio });

        rotina.agora();
        relogio.avancarMinutos(60);
        rotina.agora();

        assert.equal(readdirSync(espelho).length, 2);
        assert.equal(rotina.estado().espelho?.ultimaFalha, null);
    });

    it("apaga as antigas do espelho, como faz na pasta local", () => {
        const pasta = pastaNova();
        const espelho = pastaNova();
        const relogio = new RelogioFalso("2026-09-14T20:00:00.000Z");
        const rotina = new RotinaDeBackup(escrever, { pasta, espelho, aCadaHoras: 6, copias: 2, relogio });

        for (let i = 0; i < 4; i += 1) {
            rotina.agora();
            relogio.avancarMinutos(60);
        }

        assert.equal(readdirSync(pasta).length, 2);
        assert.equal(readdirSync(espelho).length, 2, "o espelho encheria para sempre");
    });

    it("espelho inacessível não derruba a cópia local", () => {
        // O caso real: pendrive tirado da porta, OneDrive desconectado. Ficar
        // sem backup nenhum por causa disso seria trocar um risco por um pior.
        const pasta = pastaNova();
        const arquivo = join(pastaNova(), "isto-e-um-arquivo");
        writeFileSync(arquivo, "x");
        const espelho = join(arquivo, "impossivel");
        const relogio = new RelogioFalso("2026-09-14T20:00:00.000Z");

        const rotina = new RotinaDeBackup(escrever, { pasta, espelho, aCadaHoras: 6, copias: 5, relogio });
        const destino = rotina.agora();

        assert.ok(destino !== null, "a cópia local tinha de ter saído");
        assert.equal(readdirSync(pasta).length, 1);
        assert.notEqual(rotina.estado().espelho?.ultimaFalha, null);
    });
});

describe("estado do backup, para /saude contar", () => {
    const escrever = (destino: string) => writeFileSync(destino, "conteudo");

    it("começa sem nenhuma cópia", () => {
        const rotina = new RotinaDeBackup(escrever, { pasta: pastaNova(), aCadaHoras: 6, copias: 5 });
        const estado = rotina.estado();

        assert.equal(estado.ultimaCopiaEm, null);
        assert.equal(estado.ultimaFalha, null);
        assert.equal(estado.falhasSeguidas, 0);
    });

    it("guarda quando e onde foi a última", () => {
        const pasta = pastaNova();
        const relogio = new RelogioFalso("2026-09-14T20:00:00.000Z");
        const rotina = new RotinaDeBackup(escrever, { pasta, aCadaHoras: 6, copias: 5, relogio });
        rotina.agora();

        const estado = rotina.estado();
        assert.equal(estado.ultimaCopiaEm, "2026-09-14T20:00:00.000Z");
        assert.ok(String(estado.ultimoArquivo).startsWith(pasta));
        assert.equal(estado.ultimaFalha, null);
    });

    it("conta as falhas seguidas, que é o sinal de que parou de copiar", () => {
        const explodir = () => {
            throw new Error("disco cheio");
        };
        const rotina = new RotinaDeBackup(explodir, { pasta: pastaNova(), aCadaHoras: 6, copias: 5 });

        rotina.agora();
        rotina.agora();
        rotina.agora();

        const estado = rotina.estado();
        assert.equal(estado.falhasSeguidas, 3);
        assert.match(String(estado.ultimaFalha), /disco cheio/u);
        assert.equal(estado.ultimaCopiaEm, null);
    });

    it("um sucesso zera a contagem de falhas", () => {
        const pasta = pastaNova();
        let vaiFalhar = true;
        const asVezes = (destino: string) => {
            if (vaiFalhar) {
                throw new Error("falhou");
            }
            writeFileSync(destino, "conteudo");
        };
        const rotina = new RotinaDeBackup(asVezes, { pasta, aCadaHoras: 6, copias: 5 });

        rotina.agora();
        assert.equal(rotina.estado().falhasSeguidas, 1);

        vaiFalhar = false;
        rotina.agora();

        const estado = rotina.estado();
        assert.equal(estado.falhasSeguidas, 0);
        assert.equal(estado.ultimaFalha, null);
    });

    it("sem espelho configurado, não inventa um estado para ele", () => {
        const rotina = new RotinaDeBackup(escrever, { pasta: pastaNova(), aCadaHoras: 6, copias: 5 });
        assert.equal(rotina.estado().espelho, null);
    });
});
