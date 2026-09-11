import { DatabaseSync } from "node:sqlite";
import { type Relogio, relogioDoSistema } from "../../compartilhado/tempo/relogio.js";
import type { Mesa, StatusMesa } from "../../dominio/entidades/mesa.js";
import { Salao } from "../../dominio/entidades/salao.js";
import type { EstadoDaMesa, EstadoDoItemFila, EstadoDoSalao } from "../../dominio/estado.js";
import type { RepositorioDoSalao } from "../../dominio/portas/repositorio-do-salao.js";

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS mesas (
    id                TEXT    PRIMARY KEY,
    numero            INTEGER NOT NULL,
    capacidade        INTEGER NOT NULL,
    status            TEXT    NOT NULL,
    cliente_nome      TEXT,
    cliente_telefone  TEXT,
    cliente_pessoas   INTEGER,
    cliente_chegada   TEXT
);

CREATE TABLE IF NOT EXISTS fila (
    ordem        INTEGER PRIMARY KEY,
    nome         TEXT    NOT NULL,
    telefone     TEXT    NOT NULL,
    pessoas      INTEGER NOT NULL,
    chegada      TEXT    NOT NULL,
    entrada      TEXT    NOT NULL,
    atendimento  TEXT
);

CREATE TABLE IF NOT EXISTS esperas (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    segundos INTEGER NOT NULL
);
`;

interface LinhaMesa {
    id: string;
    numero: number;
    capacidade: number;
    status: string;
    cliente_nome: string | null;
    cliente_telefone: string | null;
    cliente_pessoas: number | null;
    cliente_chegada: string | null;
}

interface LinhaFila {
    nome: string;
    telefone: string;
    pessoas: number;
    chegada: string;
    entrada: string;
    atendimento: string | null;
}

export interface OpcoesDoRepositorioSqlite {
    /**
     * Mesas com que abrir o salão na primeira execução. São ignoradas se o
     * banco já tiver mesas: estado persistido vence configuração, senão um
     * reinício apagaria o salão em operação.
     */
    mesas?: readonly Mesa[] | undefined;
    relogio?: Relogio | undefined;
}

/**
 * Guarda o salão num banco SQLite, via `node:sqlite` — sem dependência externa.
 *
 * Aqui `transacao` é transação de banco de verdade: `BEGIN IMMEDIATE` toma a
 * trava de escrita antes de ler, de modo que duas instâncias (ou dois
 * processos) não decidam alocações sobre o mesmo estado; `ROLLBACK` desfaz
 * tudo se a operação lançar. É o que a versão em memória só consegue dentro de
 * um processo.
 *
 * O salão é carregado e regravado por transação. Para um restaurante — dezenas
 * de mesas, dezenas de pessoas na fila — isso é mais simples e mais claramente
 * correto do que escrita incremental, e o custo é irrelevante.
 */
export class RepositorioDoSalaoSqlite implements RepositorioDoSalao {
    #db: DatabaseSync;
    #relogio: Relogio;

    constructor(caminho: string, opcoes: OpcoesDoRepositorioSqlite = {}) {
        this.#relogio = opcoes.relogio ?? relogioDoSistema;
        this.#db = new DatabaseSync(caminho);

        // WAL deixa leitura e escrita conviverem; IMMEDIATE já serializa escrita.
        this.#db.exec("PRAGMA journal_mode = WAL");
        this.#db.exec("PRAGMA foreign_keys = ON");
        this.#db.exec(ESQUEMA);

        const mesas = opcoes.mesas ?? [];
        if (mesas.length > 0) {
            this.#semearSeVazio(mesas);
        }
    }

    #semearSeVazio(mesas: readonly Mesa[]): void {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
            const { total } = this.#db.prepare("SELECT COUNT(*) AS total FROM mesas").get() as {
                total: number;
            };
            if (total === 0) {
                this.#gravar({
                    mesas: mesas.map((mesa) => mesa.estado()),
                    fila: { itens: [], esperasEmSegundos: [] }
                });
            }
            this.#db.exec("COMMIT");
        } catch (erro) {
            this.#db.exec("ROLLBACK");
            throw erro;
        }
    }

    async transacao<T>(operacao: (salao: Salao) => T): Promise<T> {
        this.#db.exec("BEGIN IMMEDIATE");
        try {
            const salao = Salao.reconstituir(this.#carregar(), this.#relogio);
            const resultado = operacao(salao);
            this.#gravar(salao.estado());
            this.#db.exec("COMMIT");
            return resultado;
        } catch (erro) {
            this.#db.exec("ROLLBACK");
            throw erro;
        }
    }

    #carregar(): EstadoDoSalao {
        const linhasMesas = this.#db
            .prepare("SELECT * FROM mesas ORDER BY numero")
            .all() as unknown as LinhaMesa[];

        const mesas: EstadoDaMesa[] = linhasMesas.map((linha) => ({
            id: linha.id,
            numero: linha.numero,
            capacidade: linha.capacidade,
            status: linha.status as StatusMesa,
            cliente:
                linha.cliente_nome === null ||
                linha.cliente_telefone === null ||
                linha.cliente_pessoas === null ||
                linha.cliente_chegada === null
                    ? null
                    : {
                          nome: linha.cliente_nome,
                          telefone: linha.cliente_telefone,
                          quantidadePessoas: linha.cliente_pessoas,
                          horaChegada: linha.cliente_chegada
                      }
        }));

        const linhasFila = this.#db
            .prepare("SELECT * FROM fila ORDER BY ordem")
            .all() as unknown as LinhaFila[];

        const itens: EstadoDoItemFila[] = linhasFila.map((linha) => ({
            cliente: {
                nome: linha.nome,
                telefone: linha.telefone,
                quantidadePessoas: linha.pessoas,
                horaChegada: linha.chegada
            },
            dataEntrada: linha.entrada,
            dataAtendimento: linha.atendimento
        }));

        const esperas = this.#db.prepare("SELECT segundos FROM esperas ORDER BY id").all() as unknown as {
            segundos: number;
        }[];

        return { mesas, fila: { itens, esperasEmSegundos: esperas.map((e) => e.segundos) } };
    }

    #gravar(estado: EstadoDoSalao): void {
        this.#db.exec("DELETE FROM mesas");
        this.#db.exec("DELETE FROM fila");
        this.#db.exec("DELETE FROM esperas");

        const inserirMesa = this.#db.prepare(
            `INSERT INTO mesas
                (id, numero, capacidade, status, cliente_nome, cliente_telefone, cliente_pessoas, cliente_chegada)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const mesa of estado.mesas) {
            inserirMesa.run(
                mesa.id,
                mesa.numero,
                mesa.capacidade,
                mesa.status,
                mesa.cliente?.nome ?? null,
                mesa.cliente?.telefone ?? null,
                mesa.cliente?.quantidadePessoas ?? null,
                mesa.cliente?.horaChegada ?? null
            );
        }

        const inserirItem = this.#db.prepare(
            `INSERT INTO fila (ordem, nome, telefone, pessoas, chegada, entrada, atendimento)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        estado.fila.itens.forEach((item, ordem) => {
            inserirItem.run(
                ordem,
                item.cliente.nome,
                item.cliente.telefone,
                item.cliente.quantidadePessoas,
                item.cliente.horaChegada,
                item.dataEntrada,
                item.dataAtendimento
            );
        });

        const inserirEspera = this.#db.prepare("INSERT INTO esperas (segundos) VALUES (?)");
        for (const segundos of estado.fila.esperasEmSegundos) {
            inserirEspera.run(segundos);
        }
    }

    /** Fecha o banco. Chame ao encerrar o processo. */
    fechar(): void {
        this.#db.close();
    }
}
