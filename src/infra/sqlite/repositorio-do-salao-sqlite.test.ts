import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { RepositorioDoSalaoSqlite } from "./repositorio-do-salao-sqlite.js";
import { Cliente } from "../../dominio/entidades/cliente.js";
import { Mesa, StatusMesa } from "../../dominio/entidades/mesa.js";
import { verificarContratoDoRepositorio } from "../../dominio/portas/contrato-do-repositorio.test.js";

/** Cada repositório de teste ganha um banco próprio num diretório temporário. */
function bancoTemporario(): { caminho: string; apagar: () => void } {
    const pasta = mkdtempSync(join(tmpdir(), "salao-"));
    return {
        caminho: join(pasta, "salao.db"),
        apagar: () => rmSync(pasta, { recursive: true, force: true })
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
