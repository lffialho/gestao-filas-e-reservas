import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Sobe o serviço e o painel juntos, num terminal só.
 *
 * Existe porque "abra dois terminais e rode um comando em cada" não é
 * instrução que se dê a quem toca um restaurante. Ele também **levanta de novo
 * o que cair**: se um dos dois morrer sozinho — exceção não prevista, falta de
 * memória, o que for —, sobe outro em segundos, em vez de o salão descobrir no
 * meio do movimento que o painel não responde mais.
 *
 * Isto é o supervisor de quem roda na mão. Para a máquina do balcão, que tem de
 * subir sozinha ao ligar, use `ferramentas/instalar-windows.ps1` — lá quem
 * supervisiona é o próprio Windows, que continua de pé mesmo se este processo
 * não existir.
 */

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ = resolve(AQUI, "..");

/** Espera antes de subir de novo, para não entrar em laço de reinício. */
const ESPERA_PARA_SUBIR_EM_MS = 2000;

/** Reinícios seguidos e rápidos que indicam problema de configuração, não pane. */
const REINICIOS_ATE_DESISTIR = 5;
const JANELA_DE_REINICIOS_EM_MS = 60_000;

const PECAS = [
    { nome: "serviço", script: join(RAIZ, "dist", "main.js") },
    { nome: "painel", script: join(RAIZ, "web", "dist", "servidor.js") }
];

/**
 * O painel e o serviço se acham por variáveis diferentes — `PORTA` de um lado,
 * `SALAO_API` do outro — e o `.env.example` traz a porta escrita nos dois
 * lugares. Trocar só uma delas deixa o painel falando com uma porta onde não
 * tem ninguém: ele sobe, a tela abre e nada carrega, e o erro aparece como
 * "o painel parou de funcionar" em vez de "a configuração está errada".
 *
 * Como este é o único processo que sobe os dois, é aqui que dá para notar.
 * Só reclamamos quando o `SALAO_API` aponta para a própria máquina: apontar
 * para outro host é escolha deliberada, e não é nossa para contrariar.
 */
function conferirPortas() {
    const alvo = process.env["SALAO_API"];
    const porta = process.env["PORTA"];
    if (alvo === undefined || porta === undefined) {
        return;
    }

    let url;
    try {
        url = new URL(alvo);
    } catch {
        // Endereço inválido é problema do painel, e ele reclama melhor do que nós.
        return;
    }

    const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
    const portaDoAlvo = url.port === "" ? (url.protocol === "https:" ? "443" : "80") : url.port;
    if (!local || portaDoAlvo === porta.trim()) {
        return;
    }

    process.stderr.write(
        `${agora()} configuração inconsistente: o serviço sobe na porta ${porta.trim()}, ` +
            `mas o painel procura a API em ${alvo}.\n` +
            "Acerte SALAO_API para essa porta (ou PORTA para a do SALAO_API) e rode de novo.\n"
    );
    process.exit(1);
}

let encerrando = false;
const vivos = new Set();

function agora() {
    return new Date().toISOString();
}

function subir(peca, reinicios = []) {
    // O mesmo node que está rodando isto — sem depender do PATH da máquina.
    const filho = spawn(process.execPath, [peca.script], {
        cwd: RAIZ,
        stdio: ["ignore", "inherit", "inherit"],
        env: process.env
    });

    vivos.add(filho);

    filho.on("exit", (codigo, sinal) => {
        vivos.delete(filho);
        if (encerrando) {
            return;
        }

        const recentes = [...reinicios, Date.now()].filter(
            (quando) => Date.now() - quando < JANELA_DE_REINICIOS_EM_MS
        );

        process.stderr.write(
            `${agora()} o ${peca.nome} caiu (código ${codigo ?? "—"}, sinal ${sinal ?? "—"}).\n`
        );

        if (recentes.length >= REINICIOS_ATE_DESISTIR) {
            process.stderr.write(
                `${agora()} o ${peca.nome} caiu ${recentes.length} vezes em um minuto. ` +
                    "Isso é configuração errada, não pane: leia o erro acima. Encerrando.\n"
            );
            encerrar("reinícios demais");
            return;
        }

        process.stderr.write(`${agora()} subindo o ${peca.nome} de novo em 2s…\n`);
        setTimeout(() => subir(peca, recentes), ESPERA_PARA_SUBIR_EM_MS);
    });

    filho.on("error", (erro) => {
        process.stderr.write(`${agora()} não consegui iniciar o ${peca.nome}: ${erro.message}\n`);
    });

    return filho;
}

function encerrar(motivo) {
    if (encerrando) {
        return;
    }
    encerrando = true;
    process.stderr.write(`${agora()} encerrando (${motivo})…\n`);

    for (const filho of vivos) {
        // SIGTERM: no Linux e no macOS os dois fecham banco e conexões ao
        // receber. **No Windows não** — medido: o processo morre na hora, sem
        // passar pelo encerramento. Não é perda: o SQLite roda em WAL e aguenta
        // morte súbita; o que se perde é a cópia de despedida do banco, e por
        // isso quem garante backup é a cópia periódica, não esta linha.
        filho.kill("SIGTERM");
    }

    // Se algum não sair sozinho, não ficamos presos aqui.
    setTimeout(() => {
        for (const filho of vivos) {
            filho.kill("SIGKILL");
        }
        process.exit(0);
    }, 8000).unref();
}

process.on("SIGINT", () => encerrar("SIGINT"));
process.on("SIGTERM", () => encerrar("SIGTERM"));

conferirPortas();

for (const peca of PECAS) {
    subir(peca);
}
