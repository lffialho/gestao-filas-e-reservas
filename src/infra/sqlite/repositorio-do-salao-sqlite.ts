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
    cliente_chegada   TEXT,
    coluna            INTEGER,
    linha             INTEGER
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

CREATE TABLE IF NOT EXISTS resumo_de_esperas (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    soma         INTEGER NOT NULL,
    atendimentos INTEGER NOT NULL
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
    coluna: number | null;
    linha: number | null;
}

interface LinhaFila {
    nome: string;
    telefone: string;
    pessoas: number;
    chegada: string;
    entrada: string;
    atendimento: string | null;
}

interface LinhaResumo {
    soma: number;
    atendimentos: number;
}

export interface OpcoesDoRepositorioSqlite {
    /**
     * Mesas com que abrir o salão na primeira execução. São ignoradas se o
     * banco já tiver mesas: estado persistido vence configuração, senão um
     * reinício apagaria o salão em operação.
     */
    mesas?: readonly Mesa[] | undefined;
    relogio?: Relogio | undefined;
    /**
     * Quanto esperar por uma trava tomada por outro processo, em ms. Zero — o
     * padrão do SQLite — faz qualquer disputa falhar na hora com "database is
     * locked", inclusive uma leitura que só esbarrou numa escrita em curso.
     */
    esperaPorTravaEmMs?: number | undefined;
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
        this.#db.exec(`PRAGMA busy_timeout = ${opcoes.esperaPorTravaEmMs ?? 5000}`);
        this.#db.exec(ESQUEMA);
        this.#migrarEsperasAntigas();

        const mesas = opcoes.mesas ?? [];
        if (mesas.length > 0) {
            this.#semearSeVazio(mesas);
        }
    }

    /**
     * Versões anteriores guardavam uma linha por atendimento na tabela
     * `esperas`, e `#gravar` reescrevia a tabela inteira a cada transação —
     * custo que crescia com o movimento do restaurante e nunca baixava. Dobra
     * o que houver lá no resumo, com o mesmo tempo médio, e apaga a tabela.
     */
    #migrarEsperasAntigas(): void {
        const antiga = this.#db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'esperas'")
            .get();
        if (antiga === undefined) {
            return;
        }

        this.#db.exec("BEGIN IMMEDIATE");
        try {
            const acumulado = this.#db
                .prepare("SELECT COALESCE(SUM(segundos), 0) AS soma, COUNT(*) AS atendimentos FROM esperas")
                .get() as unknown as LinhaResumo;

            if (acumulado.atendimentos > 0) {
                const atual = this.#lerResumo();
                this.#gravarResumo({
                    soma: atual.soma + acumulado.soma,
                    atendimentos: atual.atendimentos + acumulado.atendimentos
                });
            }

            this.#db.exec("DROP TABLE esperas");
            this.#db.exec("COMMIT");
        } catch (erro) {
            this.#desfazer();
            throw erro;
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
                    fila: { itens: [], esperas: { somaEmSegundos: 0, atendimentos: 0 } }
                });
            }
            this.#db.exec("COMMIT");
        } catch (erro) {
            this.#desfazer();
            throw erro;
        }
    }

    /**
     * Desfaz sem mascarar. Se a transação já caiu por conta do próprio SQLite,
     * o ROLLBACK falha — e deixar esse erro subir trocaria a causa real
     * ("database is locked") por um "no transaction is active" sem sentido.
     */
    #desfazer(): void {
        try {
            this.#db.exec("ROLLBACK");
        } catch {
            // Não havia transação aberta: nada a desfazer.
        }
    }

    /**
     * `BEGIN` fica fora do `try` de propósito: se ele falhar, não há transação
     * a desfazer, e o erro sobe como veio.
     */
    #dentroDe<T>(inicio: string, operacao: (salao: Salao) => T, gravar: boolean): T {
        this.#db.exec(inicio);
        try {
            const salao = Salao.reconstituir(this.#carregar(), this.#relogio);
            const resultado = operacao(salao);
            if (gravar) {
                this.#gravar(salao.estado());
            }
            this.#db.exec("COMMIT");
            return resultado;
        } catch (erro) {
            this.#desfazer();
            throw erro;
        }
    }

    async transacao<T>(operacao: (salao: Salao) => T): Promise<T> {
        return this.#dentroDe("BEGIN IMMEDIATE", operacao, true);
    }

    /**
     * Leitura: `DEFERRED` pega só a trava de leitura — em WAL ela nem espera
     * uma escrita em curso — e nada é gravado no fim. Com `BEGIN IMMEDIATE` e
     * regravação, como era antes, um `GET` competia com todo mundo e reescrevia
     * as três tabelas para devolver um número.
     */
    async consulta<T>(leitura: (salao: Salao) => T): Promise<T> {
        return this.#dentroDe("BEGIN DEFERRED", leitura, false);
    }

    #lerResumo(): LinhaResumo {
        const linha = this.#db
            .prepare("SELECT soma, atendimentos FROM resumo_de_esperas WHERE id = 1")
            .get() as unknown as LinhaResumo | undefined;
        return linha ?? { soma: 0, atendimentos: 0 };
    }

    #gravarResumo(resumo: LinhaResumo): void {
        this.#db
            .prepare("INSERT OR REPLACE INTO resumo_de_esperas (id, soma, atendimentos) VALUES (1, ?, ?)")
            .run(resumo.soma, resumo.atendimentos);
    }

    #carregar(): EstadoDoSalao {
        // `numero` é único, mas o id desempata caso um banco antigo traga
        // duplicata: ordem instável faria o mesmo salão sair diferente a cada
        // reinício.
        const linhasMesas = this.#db
            .prepare("SELECT * FROM mesas ORDER BY numero, id")
            .all() as unknown as LinhaMesa[];

        const mesas: EstadoDaMesa[] = linhasMesas.map((linha) => ({
            id: linha.id,
            numero: linha.numero,
            capacidade: linha.capacidade,
            status: linha.status as StatusMesa,
            posicao:
                linha.coluna === null || linha.linha === null
                    ? null
                    : { coluna: linha.coluna, linha: linha.linha },
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

        const resumo = this.#lerResumo();

        return {
            mesas,
            fila: {
                itens,
                esperas: { somaEmSegundos: resumo.soma, atendimentos: resumo.atendimentos }
            }
        };
    }

    #gravar(estado: EstadoDoSalao): void {
        this.#db.exec("DELETE FROM mesas");
        this.#db.exec("DELETE FROM fila");

        const inserirMesa = this.#db.prepare(
            `INSERT INTO mesas
                (id, numero, capacidade, status, cliente_nome, cliente_telefone, cliente_pessoas,
                 cliente_chegada, coluna, linha)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
                mesa.cliente?.horaChegada ?? null,
                mesa.posicao?.coluna ?? null,
                mesa.posicao?.linha ?? null
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

        // Uma linha, sempre a mesma: o custo de gravar não cresce com quantas
        // pessoas o salão já atendeu.
        this.#gravarResumo({
            soma: estado.fila.esperas.somaEmSegundos,
            atendimentos: estado.fila.esperas.atendimentos
        });
    }

    /** Fecha o banco. Chame ao encerrar o processo. */
    fechar(): void {
        this.#db.close();
    }
}
