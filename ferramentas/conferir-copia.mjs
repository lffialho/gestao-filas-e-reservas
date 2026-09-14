import { DatabaseSync } from "node:sqlite";

/**
 * Diz se uma cópia do banco presta, sem restaurar nada.
 *
 * Backup que nunca foi aberto não é backup: é um arquivo que se espera que
 * sirva. Isto existe para que dê para descobrir que a cópia está ruim num
 * momento tranquilo, e não na noite em que ela é a única coisa que restou.
 *
 * Também é o que `restaurar-windows.ps1` roda antes de trocar o banco — nunca
 * se troca um banco bom por uma cópia que não abre.
 *
 *   node ferramentas/conferir-copia.mjs caminho/da/copia.db
 *
 * Sai com 0 se a cópia serve, 1 se não serve.
 */

/** As tabelas sem as quais o salão não sobe. Cópia sem elas não é deste sistema. */
const TABELAS = ["mesas", "fila", "eventos", "resumo_de_esperas"];

function reclamar(mensagem) {
    process.stderr.write(`${mensagem}\n`);
    return 1;
}

/**
 * Tudo numa função para que o `finally` feche o banco em qualquer saída.
 * `process.exit()` no meio do `try` pularia o `finally`, e no Windows o arquivo
 * fica preso enquanto o banco estiver aberto — justamente o arquivo que quem
 * chamou isto quer mover em seguida.
 */
function conferir(caminho) {
    let banco;
    try {
        // Só leitura: conferir uma cópia não pode ser o que estraga a cópia.
        banco = new DatabaseSync(caminho, { readOnly: true });
    } catch (erro) {
        return reclamar(`não abre: ${caminho}\n${erro.message}`);
    }

    try {
        // Abrir não lê nada: um arquivo de texto com nome .db só se revela aqui,
        // na primeira consulta. Por isso o try cobre tudo, e não só a abertura.
        //
        // `integrity_check` lê o banco inteiro e é o que pega corrupção
        // silenciosa — a que não aparece ao abrir, só quando a página ruim é
        // finalmente lida.
        const integridade = banco.prepare("PRAGMA integrity_check").get()?.["integrity_check"];
        if (integridade !== "ok") {
            return reclamar(`corrompida: ${caminho}\n${integridade}`);
        }

        const presentes = new Set(
            banco
                .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
                .all()
                .map((linha) => linha["name"])
        );
        const faltando = TABELAS.filter((tabela) => !presentes.has(tabela));
        if (faltando.length > 0) {
            return reclamar(`não é um banco do salão: faltam ${faltando.join(", ")}`);
        }

        // Contagens não provam que os dados estão certos, mas mostram na hora se
        // a cópia é de um salão vazio — o engano caro de não perceber ao restaurar.
        const mesas = banco.prepare("SELECT COUNT(*) AS n FROM mesas").get()?.["n"];
        const fila = banco.prepare("SELECT COUNT(*) AS n FROM fila").get()?.["n"];
        const eventos = banco.prepare("SELECT COUNT(*) AS n FROM eventos").get()?.["n"];

        process.stdout.write(`ok  ${mesas} mesas, ${fila} na fila, ${eventos} eventos no diário\n`);
        return 0;
    } catch (erro) {
        // Quem lê isto está decidindo se restaura ou não. Pilha de chamada não
        // ajuda nessa decisão; saber que o arquivo não serve, ajuda.
        return reclamar(`não serve: ${caminho}\n${erro.message}`);
    } finally {
        banco.close();
    }
}

const caminho = process.argv[2];
process.exitCode =
    caminho === undefined
        ? reclamar("uso: node ferramentas/conferir-copia.mjs <arquivo.db>")
        : conferir(caminho);
