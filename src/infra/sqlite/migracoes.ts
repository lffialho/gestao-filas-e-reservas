import type { DatabaseSync } from "node:sqlite";
import type { Relogio } from "../../compartilhado/tempo/relogio.js";

/**
 * Migrações do banco, numeradas e aplicadas em ordem.
 *
 * Cada casa fica com o próprio arquivo, e uma que passe meses sem atualizar
 * recebe várias mudanças de uma vez. O número já aplicado fica em
 * `PRAGMA user_version`, no cabeçalho do arquivo, e é transacional.
 *
 * Ao escrever uma nova: acrescente ao fim, com o número seguinte, e nunca edite
 * uma que já saiu daqui — bancos lá fora já a aplicaram. Use SQL cru, não os
 * métodos do repositório, que mudam com o tempo.
 */

export interface Migracao {
    /** Sequencial, a partir de 1. É o valor que vai para `user_version`. */
    readonly versao: number;
    readonly descricao: string;
    aplicar(banco: DatabaseSync, relogio: Relogio): void;
}

const ESQUEMA_BASE = `
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
    linha             INTEGER,
    desde             TEXT    NOT NULL
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

-- Só cresce: o diário nunca é reescrito, ao contrário das outras tabelas.
CREATE TABLE IF NOT EXISTS eventos (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    momento      TEXT    NOT NULL,
    tipo         TEXT    NOT NULL,
    mesa_id      TEXT,
    mesa_numero  INTEGER,
    capacidade   INTEGER,
    telefone     TEXT,
    nome         TEXT,
    pessoas      INTEGER,
    espera       INTEGER,
    permanencia  INTEGER
);

CREATE INDEX IF NOT EXISTS eventos_por_momento ON eventos (momento);
`;

/**
 * Bancos anteriores não guardavam desde quando cada mesa está no seu status.
 * Não dá para descobrir isso depois, então as mesas existentes passam a contar
 * a partir da migração — errado por uma noite, e certo daí em diante.
 */
function acrescentarColunaDesde(banco: DatabaseSync, relogio: Relogio): void {
    const colunas = banco.prepare("PRAGMA table_info(mesas)").all() as unknown as { name: string }[];
    if (colunas.some((coluna) => coluna.name === "desde")) {
        return;
    }

    banco.exec("ALTER TABLE mesas ADD COLUMN desde TEXT NOT NULL DEFAULT ''");
    banco.prepare("UPDATE mesas SET desde = ? WHERE desde = ''").run(relogio.agora().toISOString());
}

/**
 * Versões anteriores guardavam uma linha por atendimento na tabela `esperas`, e
 * a gravação reescrevia a tabela inteira a cada transação — custo que crescia
 * com o movimento do restaurante e nunca baixava. Dobra o que houver lá no
 * resumo, com o mesmo tempo médio, e só então apaga a tabela.
 */
function dobrarEsperasNoResumo(banco: DatabaseSync): void {
    const antiga = banco
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'esperas'")
        .get();
    if (antiga === undefined) {
        return;
    }

    const acumulado = banco
        .prepare("SELECT COALESCE(SUM(segundos), 0) AS soma, COUNT(*) AS atendimentos FROM esperas")
        .get() as unknown as { soma: number; atendimentos: number };

    if (acumulado.atendimentos > 0) {
        const atual = (banco
            .prepare("SELECT soma, atendimentos FROM resumo_de_esperas WHERE id = 1")
            .get() ?? { soma: 0, atendimentos: 0 }) as unknown as { soma: number; atendimentos: number };

        banco
            .prepare("INSERT OR REPLACE INTO resumo_de_esperas (id, soma, atendimentos) VALUES (1, ?, ?)")
            .run(atual.soma + acumulado.soma, atual.atendimentos + acumulado.atendimentos);
    }

    banco.exec("DROP TABLE esperas");
}

export const MIGRACOES: readonly Migracao[] = [
    {
        versao: 1,
        descricao: "esquema base, coluna desde e resumo de esperas",
        /**
         * A 1 é a linha de partida, e por isso é a única que precisa aceitar um
         * banco que já existe. Todo `CREATE` é `IF NOT EXISTS` e os dois
         * ajustes conferem antes de mexer: num banco novo ela cria tudo; num
         * banco das versões sem `user_version` ela reconhece o que já está lá e
         * só completa o que falta. Das próximas em diante não é preciso esse
         * cuidado — a versão gravada diz exatamente o que falta aplicar.
         */
        aplicar(banco, relogio) {
            banco.exec(ESQUEMA_BASE);
            acrescentarColunaDesde(banco, relogio);
            dobrarEsperasNoResumo(banco);
        }
    }
];

/** A versão que este código conhece. */
export function versaoMaisNova(migracoes: readonly Migracao[] = MIGRACOES): number {
    return migracoes.reduce((maior, migracao) => Math.max(maior, migracao.versao), 0);
}

export class BancoDeVersaoFutura extends Error {
    readonly versaoDoBanco: number;
    readonly versaoDoCodigo: number;

    constructor(versaoDoBanco: number, versaoDoCodigo: number) {
        super(
            `O banco está na versão ${versaoDoBanco} e este programa conhece até a ${versaoDoCodigo}. ` +
                "Ele foi usado por uma versão mais nova do salão; atualize o programa em vez de abrir " +
                "o banco com esta versão."
        );
        this.name = "BancoDeVersaoFutura";
        this.versaoDoBanco = versaoDoBanco;
        this.versaoDoCodigo = versaoDoCodigo;
    }
}

function lerVersao(banco: DatabaseSync): number {
    const linha = banco.prepare("PRAGMA user_version").get() as unknown as
        | { user_version: number }
        | undefined;
    return linha?.user_version ?? 0;
}

/**
 * Põe o banco na versão deste código e devolve quantas migrações aplicou.
 *
 * Cada migração roda na própria transação, com a versão subindo junto: se a
 * terceira de quatro falhar, as duas primeiras ficam e a versão gravada diz
 * isso. Abrir de novo retoma de onde parou, em vez de refazer tudo.
 *
 * Banco mais novo que o código é recusado. Voltar uma versão do programa é
 * exatamente o que alguém faz quando uma atualização dá problema, e nesse
 * momento o banco já tem colunas que o código velho não conhece: seguir em
 * frente significaria gravar por cima com o formato antigo. Recusar com o
 * motivo escrito custa uma noite de aborrecimento; a alternativa custa o
 * histórico.
 */
export function migrar(
    banco: DatabaseSync,
    relogio: Relogio,
    migracoes: readonly Migracao[] = MIGRACOES
): number {
    const doBanco = lerVersao(banco);
    const doCodigo = versaoMaisNova(migracoes);

    if (doBanco > doCodigo) {
        throw new BancoDeVersaoFutura(doBanco, doCodigo);
    }

    const pendentes = [...migracoes]
        .filter((migracao) => migracao.versao > doBanco)
        .sort((a, b) => a.versao - b.versao);

    for (const migracao of pendentes) {
        banco.exec("BEGIN IMMEDIATE");
        try {
            migracao.aplicar(banco, relogio);
            // Interpolado porque PRAGMA não aceita parâmetro; o valor é nosso,
            // vem da lista acima e é conferido como inteiro antes de entrar.
            if (!Number.isInteger(migracao.versao) || migracao.versao < 1) {
                throw new Error(`Versão de migração inválida: ${String(migracao.versao)}.`);
            }
            banco.exec(`PRAGMA user_version = ${migracao.versao}`);
            banco.exec("COMMIT");
        } catch (erro) {
            try {
                banco.exec("ROLLBACK");
            } catch {
                // Se o próprio SQLite já derrubou a transação, o ROLLBACK falha.
                // Deixar esse erro subir trocaria a causa real por um ruído.
            }
            throw erro;
        }
    }

    return pendentes.length;
}
