import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { hostname, platform, release, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Junta num arquivo só o que se pergunta quando uma casa liga dizendo que algo
 * deu errado.
 *
 * Sem isto, o atendimento vira um interrogatório por telefone com alguém que
 * está no meio do serviço: "qual versão você tem?", "o backup rodou?", "abre o
 * Agendador e me diz o estado da tarefa". Aqui é um comando, um arquivo, e quem
 * está no balcão volta a trabalhar.
 *
 *   node ferramentas/pacote-de-suporte.mjs
 *
 * **Não leva dado de cliente.** O log já nasce mascarado — nome e telefone saem
 * mascarados de quem os escreve —, e o que este script acrescenta são versões,
 * caminhos e estados. O `.env` entra só com os nomes das variáveis, nunca com
 * os valores: o token e a senha do painel não podem viajar num anexo de e-mail.
 */

const RAIZ = resolve(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1")), "..");

/** Quantas linhas finais do log levar. O suficiente para a noite toda. */
const LINHAS_DO_LOG = 500;

const saida = [];
const escrever = (texto = "") => saida.push(texto);

function secao(titulo) {
    escrever("");
    escrever(`===== ${titulo} =====`);
}

/**
 * Lê o `.env` do projeto.
 *
 * Rodando solto — que é como quem está no balcão vai rodar —, nada do `.env`
 * está no ambiente do processo. Sem ler o arquivo, este script diria que não há
 * banco e que não há log, que é o contrário do que se quer descobrir.
 *
 * O `trim` de cada linha não é enfeite: o `.env` em Windows vem com CRLF, e o
 * retorno de carro sobrando no fim fazia o casamento falhar e a seção sair vazia.
 */
function lerEnv() {
    const caminho = join(RAIZ, ".env");
    if (!existsSync(caminho)) {
        return { existe: false, valores: {}, chaves: [] };
    }

    const valores = {};
    const chaves = [];

    for (const bruta of readFileSync(caminho, "utf8").split(/\r?\n/u)) {
        const achado = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/u.exec(bruta.trim());
        if (achado === null) {
            continue;
        }
        const [, nome, valor] = achado;
        valores[nome] = valor.trim().replace(/^"|"$/gu, "");
        // Só o nome e se está preenchido. O valor fica aqui dentro, para o
        // script achar o banco e o log — no arquivo gerado ele nunca entra.
        chaves.push(`${nome}=${valor.trim() === "" ? "(vazio)" : "(preenchido)"}`);
    }

    return { existe: true, valores, chaves };
}

const env = lerEnv();

/** O `.env` manda; o ambiente do processo serve de reserva. */
function config(nome) {
    const doArquivo = env.valores[nome];
    if (doArquivo !== undefined && doArquivo !== "") {
        return doArquivo;
    }
    const doAmbiente = process.env[nome];
    return doAmbiente === undefined || doAmbiente.trim() === "" ? undefined : doAmbiente.trim();
}

async function consultarSaude() {
    const porta = config("PORTA") ?? "3000";
    const url = `http://127.0.0.1:${porta}/saude`;
    try {
        const resposta = await fetch(url, { signal: AbortSignal.timeout(5000) });
        return { url, status: resposta.status, corpo: await resposta.text() };
    } catch (erro) {
        return { url, status: null, corpo: `não respondeu: ${erro.message}` };
    }
}

function ultimasLinhasDoLog() {
    const caminho = config("SALAO_LOG_ARQUIVO");
    if (caminho === undefined) {
        return {
            caminho: null,
            linhas: [
                "SALAO_LOG_ARQUIVO não está definida, então o log não está sendo guardado em lugar",
                "nenhum. Rodando como tarefa do Agendador, ele se perde inteiro. Defina a variável",
                "para que o próximo problema deixe rastro."
            ]
        };
    }

    const alvo = caminho.trim();
    if (!existsSync(alvo)) {
        return { caminho: alvo, linhas: [`O arquivo ainda não existe: ${alvo}`] };
    }

    const todas = readFileSync(alvo, "utf8").split("\n").filter(Boolean);
    return { caminho: alvo, linhas: todas.slice(-LINHAS_DO_LOG) };
}

function copiasDoBanco() {
    const banco = config("SALAO_BANCO");
    if (banco === undefined) {
        return ["SALAO_BANCO não definida: o salão roda em memória e não há cópias."];
    }

    const pasta = config("SALAO_BACKUP_PASTA") ?? join(dirname(resolve(RAIZ, banco)), "backups");
    if (!existsSync(pasta)) {
        return [`A pasta das cópias não existe: ${pasta}`];
    }

    try {
        const arquivos = readdirSync(pasta).filter((nome) => nome.endsWith(".db"));
        return [
            `Pasta: ${pasta}`,
            `Cópias: ${arquivos.length}`,
            ...arquivos.slice(-5).map((nome) => `  ${nome}`)
        ];
    } catch (erro) {
        return [`Não consegui ler ${pasta}: ${erro.message}`];
    }
}

// ------------------------------------------------------------------ o pacote
const agora = new Date();

escrever(`Pacote de suporte — salão`);
escrever(`Gerado em ${agora.toISOString()}`);
escrever("");
escrever("Este arquivo não contém nome nem telefone de cliente, e não contém o token");
escrever("do salão nem a senha do painel. Pode ser enviado por e-mail.");

secao("máquina");
escrever(`sistema:   ${platform()} ${release()}`);
escrever(`máquina:   ${hostname()}`);
escrever(`memória:   ${Math.round(totalmem() / 1024 / 1024 / 1024)} GB`);
escrever(`node:      ${process.version}`);
escrever(`projeto:   ${RAIZ}`);

secao("versão do salão");
try {
    const pacote = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8"));
    escrever(`versão:    ${pacote.version}`);
} catch (erro) {
    escrever(`não consegui ler o package.json: ${erro.message}`);
}
for (const construido of ["dist/main.js", "web/dist/servidor.js"]) {
    const alvo = join(RAIZ, construido);
    escrever(
        existsSync(alvo)
            ? `${construido}: compilado em ${statSync(alvo).mtime.toISOString()}`
            : `${construido}: NÃO EXISTE — falta rodar o build`
    );
}

secao("configuração (só os nomes, nunca os valores)");
if (!env.existe) {
    escrever("Não há .env neste projeto.");
} else {
    for (const chave of env.chaves) {
        escrever(chave);
    }
}

secao("saúde do serviço");
const saude = await consultarSaude();
escrever(`consultado: ${saude.url}`);
escrever(`status:     ${saude.status ?? "sem resposta"}`);
escrever(saude.corpo);

secao("cópias do banco");
for (const linha of copiasDoBanco()) {
    escrever(linha);
}

const log = ultimasLinhasDoLog();
secao(`log — últimas ${LINHAS_DO_LOG} linhas${log.caminho === null ? "" : ` de ${log.caminho}`}`);
for (const linha of log.linhas) {
    escrever(linha);
}

const destino = join(RAIZ, `suporte-${agora.toISOString().replace(/[:.]/gu, "-")}.txt`);
writeFileSync(destino, `${saida.join("\n")}\n`, "utf8");

process.stdout.write(`Pacote gerado em:\n  ${destino}\n\n`);
process.stdout.write("Confira o conteúdo antes de enviar e mande esse arquivo para o suporte.\n");
