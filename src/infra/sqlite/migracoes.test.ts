import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { BancoDeVersaoFutura, migrar, MIGRACOES, type Migracao, versaoMaisNova } from "./migracoes.js";
import { relogioDoSistema } from "../../compartilhado/tempo/relogio.js";

const relogioFixo = { agora: () => new Date("2026-09-14T20:00:00.000Z") };

function versaoDe(banco: DatabaseSync): number {
    return (banco.prepare("PRAGMA user_version").get() as unknown as { user_version: number }).user_version;
}

function tabelas(banco: DatabaseSync): string[] {
    return (
        banco.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as unknown as {
            name: string;
        }[]
    )
        .map((linha) => linha.name)
        .sort();
}

describe("migrações, num banco novo", () => {
    it("aplica tudo e grava a versão", () => {
        const banco = new DatabaseSync(":memory:");
        const aplicadas = migrar(banco, relogioFixo);

        assert.equal(aplicadas, MIGRACOES.length);
        assert.equal(versaoDe(banco), versaoMaisNova());
        banco.close();
    });

    it("cria as tabelas do salão", () => {
        const banco = new DatabaseSync(":memory:");
        migrar(banco, relogioFixo);

        for (const nome of ["mesas", "fila", "resumo_de_esperas", "eventos"]) {
            assert.ok(tabelas(banco).includes(nome), `faltou ${nome}`);
        }
        banco.close();
    });

    it("abrir de novo não aplica nada", () => {
        const banco = new DatabaseSync(":memory:");
        migrar(banco, relogioFixo);
        assert.equal(migrar(banco, relogioFixo), 0);
        banco.close();
    });
});

describe("migrações, num banco de versão anterior", () => {
    /** Um banco como as versões antigas deixavam: sem `desde`, com `esperas`. */
    function bancoAntigo(): DatabaseSync {
        const banco = new DatabaseSync(":memory:");
        banco.exec(`
            CREATE TABLE mesas (
                id TEXT PRIMARY KEY, numero INTEGER NOT NULL, capacidade INTEGER NOT NULL,
                status TEXT NOT NULL, cliente_nome TEXT, cliente_telefone TEXT,
                cliente_pessoas INTEGER, cliente_chegada TEXT, coluna INTEGER, linha INTEGER
            );
            CREATE TABLE esperas (id INTEGER PRIMARY KEY AUTOINCREMENT, segundos INTEGER NOT NULL);
            INSERT INTO mesas (id, numero, capacidade, status) VALUES ('m1', 1, 2, 'DISPONIVEL');
            INSERT INTO esperas (segundos) VALUES (100), (200), (300);
        `);
        return banco;
    }

    it("um banco sem user_version é tratado como versão zero", () => {
        const banco = bancoAntigo();
        assert.equal(versaoDe(banco), 0);
        assert.equal(migrar(banco, relogioFixo), MIGRACOES.length);
        banco.close();
    });

    it("acrescenta a coluna desde sem perder as mesas", () => {
        const banco = bancoAntigo();
        migrar(banco, relogioFixo);

        const mesa = banco
            .prepare("SELECT id, numero, desde FROM mesas WHERE id = 'm1'")
            .get() as unknown as { id: string; numero: number; desde: string };
        assert.equal(mesa.numero, 1);
        assert.equal(mesa.desde, "2026-09-14T20:00:00.000Z");
        banco.close();
    });

    it("dobra as esperas antigas no resumo, com a mesma soma", () => {
        const banco = bancoAntigo();
        migrar(banco, relogioFixo);

        const resumo = banco
            .prepare("SELECT soma, atendimentos FROM resumo_de_esperas WHERE id = 1")
            .get() as unknown as { soma: number; atendimentos: number };
        assert.equal(resumo.soma, 600);
        assert.equal(resumo.atendimentos, 3);
        banco.close();
    });

    it("apaga a tabela esperas só depois de somar", () => {
        const banco = bancoAntigo();
        migrar(banco, relogioFixo);
        assert.equal(tabelas(banco).includes("esperas"), false);
        banco.close();
    });

    it("não dobra de novo ao abrir outra vez", () => {
        const banco = bancoAntigo();
        migrar(banco, relogioFixo);
        migrar(banco, relogioFixo);

        const resumo = banco
            .prepare("SELECT soma, atendimentos FROM resumo_de_esperas WHERE id = 1")
            .get() as unknown as { soma: number; atendimentos: number };
        assert.equal(resumo.soma, 600);
        banco.close();
    });
});

describe("banco de versão futura", () => {
    it("é recusado em vez de gravado por cima", () => {
        // O caso real: alguém volta uma versão do programa depois de uma
        // atualização ruim, e o banco já tem o formato novo.
        const banco = new DatabaseSync(":memory:");
        migrar(banco, relogioFixo);
        banco.exec(`PRAGMA user_version = ${versaoMaisNova() + 5}`);

        assert.throws(() => migrar(banco, relogioFixo), BancoDeVersaoFutura);
        banco.close();
    });

    it("o erro diz as duas versões, para dar o que fazer", () => {
        const banco = new DatabaseSync(":memory:");
        banco.exec("PRAGMA user_version = 99");
        try {
            migrar(banco, relogioFixo);
            assert.fail("devia ter recusado");
        } catch (erro) {
            assert.ok(erro instanceof BancoDeVersaoFutura);
            assert.equal(erro.versaoDoBanco, 99);
            assert.equal(erro.versaoDoCodigo, versaoMaisNova());
        }
        banco.close();
    });
});

describe("aplicação em ordem", () => {
    const registro: number[] = [];
    const fingidas: Migracao[] = [
        { versao: 1, descricao: "uma", aplicar: () => void registro.push(1) },
        { versao: 3, descricao: "três", aplicar: () => void registro.push(3) },
        { versao: 2, descricao: "duas", aplicar: () => void registro.push(2) }
    ];

    it("aplica da menor para a maior, mesmo fora de ordem na lista", () => {
        registro.length = 0;
        const banco = new DatabaseSync(":memory:");
        migrar(banco, relogioDoSistema, fingidas);

        assert.deepEqual(registro, [1, 2, 3]);
        assert.equal(versaoDe(banco), 3);
        banco.close();
    });

    it("retoma de onde parou, sem repetir o que já valeu", () => {
        registro.length = 0;
        const banco = new DatabaseSync(":memory:");
        banco.exec("PRAGMA user_version = 1");
        migrar(banco, relogioDoSistema, fingidas);

        assert.deepEqual(registro, [2, 3]);
        banco.close();
    });
});

describe("migração que falha", () => {
    it("não deixa a versão subir nem o trabalho pela metade", () => {
        const explosiva: Migracao[] = [
            {
                versao: 1,
                descricao: "cria e explode",
                aplicar: (banco) => {
                    banco.exec("CREATE TABLE meia_feita (x INTEGER)");
                    throw new Error("falhou no meio");
                }
            }
        ];

        const banco = new DatabaseSync(":memory:");
        assert.throws(() => migrar(banco, relogioDoSistema, explosiva), /falhou no meio/u);

        assert.equal(versaoDe(banco), 0, "a versão não podia ter subido");
        assert.equal(tabelas(banco).includes("meia_feita"), false, "a tabela devia ter sido desfeita");
        banco.close();
    });

    it("o que já tinha passado continua valendo", () => {
        const mista: Migracao[] = [
            { versao: 1, descricao: "boa", aplicar: (banco) => banco.exec("CREATE TABLE boa (x INTEGER)") },
            {
                versao: 2,
                descricao: "ruim",
                aplicar: () => {
                    throw new Error("não");
                }
            }
        ];

        const banco = new DatabaseSync(":memory:");
        assert.throws(() => migrar(banco, relogioDoSistema, mista));

        assert.equal(versaoDe(banco), 1, "a primeira devia ter ficado");
        assert.ok(tabelas(banco).includes("boa"));
        banco.close();
    });
});

describe("a lista de migrações", () => {
    it("não tem número repetido", () => {
        const numeros = MIGRACOES.map((m) => m.versao);
        assert.equal(new Set(numeros).size, numeros.length);
    });

    it("começa em 1 e não pula número", () => {
        const numeros = [...MIGRACOES.map((m) => m.versao)].sort((a, b) => a - b);
        assert.deepEqual(
            numeros,
            numeros.map((_, i) => i + 1)
        );
    });
});
