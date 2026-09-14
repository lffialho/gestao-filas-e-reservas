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
