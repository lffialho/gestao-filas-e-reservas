import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it } from "node:test";
import { RepositorioDoSalaoSqlite } from "./repositorio-do-salao-sqlite.js";
import { Cliente } from "../../dominio/entidades/cliente.js";
import { Mesa, StatusMesa } from "../../dominio/entidades/mesa.js";
import { verificarContratoDoRepositorio } from "../../dominio/portas/contrato-do-repositorio.test.js";

/**
 * Cada repositório de teste ganha um banco próprio num diretório temporário.
 *
 * Apagar é melhor esforço, de propósito. Todas as conexões são fechadas no
 * `finally` de cada teste, mas no Windows o arquivo só some quando o sistema
 * solta o descritor — e o `-wal` de um teste com muita escrita costuma demorar
 * mais. Deixar o EPERM subir pintaria de vermelho um teste que já passou, por
 * causa da faxina. O diretório é temporário: o sistema limpa depois.
 */
function bancoTemporario(): { caminho: string; apagar: () => void } {
    const pasta = mkdtempSync(join(tmpdir(), "salao-"));
    return {
        caminho: join(pasta, "salao.db"),
        apagar: () => {
            try {
                rmSync(pasta, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
            } catch {
                // O sistema ainda segura o arquivo; não é o que este teste afere.
            }
        }
    };
}

verificarContratoDoRepositorio("sqlite", (opcoes) => {
    const banco = bancoTemporario();
    const repositorio = new RepositorioDoSalaoSqlite(banco.caminho, {
        mesas: opcoes?.mesas,
        relogio: opcoes?.relogio
    });
    return {
        repositorio,
        fechar: () => {
            repositorio.fechar();
            banco.apagar();
        }
    };
});

const cliente = (nome: string, pessoas: number, telefone: string): Cliente =>
    new Cliente(nome, pessoas, telefone);

describe("RepositorioDoSalaoSqlite — durabilidade", () => {
    it("o salão sobrevive a fechar e reabrir o processo", async () => {
        const banco = bancoTemporario();
        try {
            const primeiro = new RepositorioDoSalaoSqlite(banco.caminho, {
                mesas: [new Mesa("m1", 1, 4), new Mesa("m2", 2, 2)]
            });
            await primeiro.transacao((salao) => {
                salao.receberCliente(cliente("Ana", 4, "1111"));
                salao.receberCliente(cliente("Bruno", 2, "2222"));
                salao.receberCliente(cliente("Fernando", 2, "3333"));
            });
            primeiro.fechar();

            // Outra instância, mesmo arquivo: é isto que a versão em memória não faz.
            const segundo = new RepositorioDoSalaoSqlite(banco.caminho);
            try {
                const retrato = await segundo.transacao((salao) => ({
                    m1: salao.consultarMesa("m1"),
                    m2: salao.consultarMesa("m2"),
                    fila: salao.tamanhoFila,
                    ocupacao: salao.taxaDeOcupacao
                }));

                assert.equal(retrato.m1?.status, StatusMesa.RESERVADA);
                assert.equal(retrato.m1?.cliente?.nome, "Ana");
                assert.equal(retrato.m2?.cliente?.nome, "Bruno");
                assert.equal(retrato.fila, 1, "Fernando continua na fila depois do reinício");
                assert.equal(retrato.ocupacao, 100);
            } finally {
                segundo.fechar();
            }
        } finally {
            banco.apagar();
        }
    });

    it("quem estava na fila mantém a hora de chegada após o reinício", async () => {
        const banco = bancoTemporario();
        try {
            const primeiro = new RepositorioDoSalaoSqlite(banco.caminho, {
                mesas: [new Mesa("unica", 1, 2)]
            });
            const chegada = await primeiro.transacao((salao) => {
                salao.receberCliente(cliente("Sentado", 2, "0000"));
                return salao.receberCliente(cliente("Esperando", 2, "1111"));
            });
            primeiro.fechar();

            assert.equal(chegada.destino, "fila");
            if (chegada.destino !== "fila") return;
            const horaOriginal = chegada.item.cliente.horaChegada.toISOString();

            const segundo = new RepositorioDoSalaoSqlite(banco.caminho);
            try {
                const depois = await segundo.transacao((salao) =>
                    salao.sairDaFila("1111")?.cliente.horaChegada.toISOString()
                );
                assert.equal(depois, horaOriginal);
            } finally {
                segundo.fechar();
            }
        } finally {
            banco.apagar();
        }
    });

    it("as mesas de abertura não sobrescrevem um salão já em operação", async () => {
        const banco = bancoTemporario();
        try {
            const primeiro = new RepositorioDoSalaoSqlite(banco.caminho, {
                mesas: [new Mesa("m1", 1, 4)]
            });
            await primeiro.transacao((salao) => salao.receberCliente(cliente("Ana", 4, "1111")));
            primeiro.fechar();

            // Reabrir com a mesma configuração não pode desfazer a reserva da Ana.
            const segundo = new RepositorioDoSalaoSqlite(banco.caminho, {
                mesas: [new Mesa("m1", 1, 4)]
            });
            try {
                const info = await segundo.transacao((salao) => salao.consultarMesa("m1"));
                assert.equal(info?.cliente?.nome, "Ana", "estado persistido vence configuração");
                assert.equal(await segundo.transacao((salao) => salao.totalDeMesas), 1);
            } finally {
                segundo.fechar();
            }
        } finally {
            banco.apagar();
        }
    });

    it("o rollback chega ao arquivo, não só à memória", async () => {
        const banco = bancoTemporario();
        try {
            const primeiro = new RepositorioDoSalaoSqlite(banco.caminho, {
                mesas: [new Mesa("m1", 1, 4)]
            });
            await assert.rejects(
                primeiro.transacao((salao) => {
                    salao.receberCliente(cliente("Ana", 4, "1111"));
                    throw new Error("falhou depois de reservar");
                })
            );
            primeiro.fechar();

            const segundo = new RepositorioDoSalaoSqlite(banco.caminho);
            try {
                const info = await segundo.transacao((salao) => salao.consultarMesa("m1"));
                assert.equal(info?.status, StatusMesa.DISPONIVEL, "nada da transação falha foi gravado");
                assert.equal(info?.cliente, null);
            } finally {
                segundo.fechar();
            }
        } finally {
            banco.apagar();
        }
    });

    it("recusa estado corrompido no banco em vez de aceitar", async () => {
        const banco = bancoTemporario();
        try {
            const repositorio = new RepositorioDoSalaoSqlite(banco.caminho, {
                mesas: [new Mesa("m1", 1, 4)]
            });
            try {
                // Mesa RESERVADA sem cliente viola a invariante do domínio.
                await repositorio.transacao((salao) => salao.consultarMesa("m1"));
                const db = new (await import("node:sqlite")).DatabaseSync(banco.caminho);
                db.exec("UPDATE mesas SET status = 'RESERVADA' WHERE id = 'm1'");
                db.close();

                await assert.rejects(
                    repositorio.transacao((salao) => salao.totalDeMesas),
                    {
                        name: "DadosInvalidos"
                    }
                );
            } finally {
                repositorio.fechar();
            }
        } finally {
            banco.apagar();
        }
    });
});

describe("RepositorioDoSalaoSqlite — leitura e escrita", () => {
    interface Espiao {
        /** Muda sempre que outra conexão grava no arquivo. */
        versao: () => number;
        tabela: (nome: string) => boolean;
        linhas: (tabela: string) => number;
        fechar: () => void;
    }

    /** Segunda conexão ao mesmo banco, para ver o que o repositório escreveu. */
    function espiar(caminho: string): Espiao {
        const db = new DatabaseSync(caminho);
        return {
            versao: () =>
                (db.prepare("PRAGMA data_version").get() as unknown as { data_version: number }).data_version,
            tabela: (nome) =>
                db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(nome) !==
                undefined,
            linhas: (tabela) =>
                (db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).get() as unknown as { n: number }).n,
            fechar: () => db.close()
        };
    }

    // Regressão: toda leitura passava por `transacao`, que fazia BEGIN
    // IMMEDIATE e reescrevia as tabelas — um GET tomava a trava de escrita.
    it("consulta não altera o arquivo do banco", async () => {
        const banco = bancoTemporario();
        const repositorio = new RepositorioDoSalaoSqlite(banco.caminho, { mesas: [new Mesa("m1", 1, 2)] });
        const espiao = espiar(banco.caminho);
        try {
            const antes = espiao.versao();

            await repositorio.consulta((salao) => salao.relatorio());
            await repositorio.consulta((salao) => salao.fila());
            await repositorio.consulta((salao) => salao.totalDeMesas);

            assert.equal(espiao.versao(), antes, "três leituras não podem mexer no banco");

            await repositorio.transacao((salao) => salao.receberCliente(cliente("Ana", 2, "1111")));
            assert.notEqual(espiao.versao(), antes, "a escrita, essa sim, grava");
        } finally {
            espiao.fechar();
            repositorio.fechar();
            banco.apagar();
        }
    });

    it("guarda as esperas agregadas, não uma linha por atendimento", async () => {
        const banco = bancoTemporario();
        const repositorio = new RepositorioDoSalaoSqlite(banco.caminho, { mesas: [new Mesa("m1", 1, 2)] });
        try {
            for (let i = 0; i < 50; i++) {
                await repositorio.transacao((salao) => {
                    salao.receberCliente(cliente(`A${i}`, 2, `a${i}`));
                    salao.receberCliente(cliente(`B${i}`, 2, `b${i}`));
                    salao.liberarMesa("m1");
                    salao.liberarMesa("m1");
                });
            }

            assert.equal(await repositorio.consulta((salao) => salao.tempoMedioEsperaSegundos), 0);

            // A conexão espiã é aberta só agora, e fechada antes do repositório:
            // leitor de longa duração e WAL prendem o arquivo mais do que o
            // necessário.
            const espiao = espiar(banco.caminho);
            try {
                assert.equal(espiao.tabela("esperas"), false);
                assert.equal(espiao.linhas("resumo_de_esperas"), 1, "50 atendimentos cabem numa linha só");
            } finally {
                espiao.fechar();
            }
        } finally {
            repositorio.fechar();
            banco.apagar();
        }
    });

    it("soma a tabela `esperas` de bancos antigos no resumo e a apaga", async () => {
        const banco = bancoTemporario();
        const antigo = new DatabaseSync(banco.caminho);
        antigo.exec(`
            CREATE TABLE mesas (
                id TEXT PRIMARY KEY, numero INTEGER NOT NULL, capacidade INTEGER NOT NULL,
                status TEXT NOT NULL, cliente_nome TEXT, cliente_telefone TEXT, cliente_pessoas INTEGER,
                cliente_chegada TEXT, coluna INTEGER, linha INTEGER);
            CREATE TABLE fila (
                ordem INTEGER PRIMARY KEY, nome TEXT NOT NULL, telefone TEXT NOT NULL,
                pessoas INTEGER NOT NULL, chegada TEXT NOT NULL, entrada TEXT NOT NULL, atendimento TEXT);
            CREATE TABLE esperas (id INTEGER PRIMARY KEY AUTOINCREMENT, segundos INTEGER NOT NULL);
            INSERT INTO mesas (id, numero, capacidade, status, coluna, linha)
                VALUES ('m1', 1, 2, 'DISPONIVEL', 0, 0);
            INSERT INTO esperas (segundos) VALUES (10), (20), (60);
        `);
        antigo.close();

        const repositorio = new RepositorioDoSalaoSqlite(banco.caminho);
        const espiao = espiar(banco.caminho);
        try {
            assert.equal(
                await repositorio.consulta((salao) => salao.tempoMedioEsperaSegundos),
                30,
                "a média das três esperas antigas é preservada"
            );
            assert.equal(espiao.tabela("esperas"), false, "a tabela antiga sai depois de somada");
            assert.equal(await repositorio.consulta((salao) => salao.totalDeMesas), 1);
        } finally {
            espiao.fechar();
            repositorio.fechar();
            banco.apagar();
        }
    });
});

describe("RepositorioDoSalaoSqlite — banco sem a coluna desde", () => {
    it("acrescenta a coluna e passa a contar a partir da migração", async () => {
        const banco = bancoTemporario();
        const antigo = new DatabaseSync(banco.caminho);
        antigo.exec(`
            CREATE TABLE mesas (
                id TEXT PRIMARY KEY, numero INTEGER NOT NULL, capacidade INTEGER NOT NULL,
                status TEXT NOT NULL, cliente_nome TEXT, cliente_telefone TEXT, cliente_pessoas INTEGER,
                cliente_chegada TEXT, coluna INTEGER, linha INTEGER);
            CREATE TABLE fila (
                ordem INTEGER PRIMARY KEY, nome TEXT NOT NULL, telefone TEXT NOT NULL,
                pessoas INTEGER NOT NULL, chegada TEXT NOT NULL, entrada TEXT NOT NULL, atendimento TEXT);
            INSERT INTO mesas (id, numero, capacidade, status, coluna, linha)
                VALUES ('m1', 1, 2, 'DISPONIVEL', 0, 0);
        `);
        antigo.close();

        const relogio = { agora: (): Date => new Date(1_700_000_000_000) };
        const repositorio = new RepositorioDoSalaoSqlite(banco.caminho, { relogio });
        try {
            const info = await repositorio.consulta((salao) => salao.consultarMesa("m1"));
            assert.ok(info);
            assert.equal(
                new Date(info.desde).getTime(),
                1_700_000_000_000,
                "não dá para saber quando a mesa entrou nesse status, então conta da migração"
            );
            assert.equal(info.status, StatusMesa.DISPONIVEL);
        } finally {
            repositorio.fechar();
            banco.apagar();
        }
    });
});
