import {
    createServer,
    request as pedirAoServico,
    type IncomingMessage,
    type ServerResponse
} from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Servidor do painel. Faz duas coisas, e só elas.
 *
 * Serve os arquivos de `publico/`, e repassa `/api/...` para a API do salão
 * **pondo o token aqui**. É esta a razão de o front ter um processo próprio:
 * `SALAO_TOKEN` é segredo único da equipe, e em JavaScript de navegador
 * qualquer um que abra o devtools libera todas as mesas do salão.
 *
 * Não tem estado, não tem sessão, não guarda nada. O que o navegador manda
 * atravessa; o que volta atravessa de volta.
 */

const AQUI = resolve(fileURLToPath(import.meta.url), "..", "..");
const PUBLICO = join(AQUI, "publico");

const TIPOS: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2",
    ".png": "image/png"
};

class ConfiguracaoInvalida extends Error {}

interface Configuracao {
    porta: number;
    api: URL;
    autorizacao: string | null;
}

function lerConfiguracao(): Configuracao {
    const porta = Number(process.env["PORTA_WEB"] ?? "5173");
    if (!Number.isInteger(porta) || porta < 0 || porta > 65535) {
        throw new ConfiguracaoInvalida(`PORTA_WEB inválida: "${process.env["PORTA_WEB"]}".`);
    }

    const bruto = process.env["SALAO_API"] ?? "http://127.0.0.1:3000";
    let api: URL;
    try {
        api = new URL(bruto);
    } catch {
        throw new ConfiguracaoInvalida(`SALAO_API não é uma URL: "${bruto}".`);
    }

    const token = process.env["SALAO_TOKEN"];
    if (token !== undefined && token.trim() !== "") {
        return { porta, api, autorizacao: `Bearer ${token.trim()}` };
    }
    if (process.env["SALAO_SEM_AUTENTICACAO"] === "1") {
        return { porta, api, autorizacao: null };
    }
    throw new ConfiguracaoInvalida(
        "Defina SALAO_TOKEN com o mesmo token do serviço, ou SALAO_SEM_AUTENTICACAO=1 em desenvolvimento."
    );
}

function responder(resposta: ServerResponse, status: number, tipo: string, corpo: string): void {
    resposta.writeHead(status, {
        "Content-Type": tipo,
        "Content-Length": Buffer.byteLength(corpo)
    });
    resposta.end(corpo);
}

/**
 * Serve um arquivo de `publico/`. O caminho é resolvido e conferido contra a
 * raiz antes de abrir: sem isso, `/../../.env` sairia pela porta.
 */
async function servirEstatico(caminho: string, resposta: ServerResponse): Promise<void> {
    const pedido = caminho === "/" ? "/index.html" : caminho;
    const alvo = resolve(join(PUBLICO, decodeURIComponent(pedido)));

    if (alvo !== PUBLICO && !alvo.startsWith(PUBLICO + sep)) {
        responder(resposta, 403, "text/plain; charset=utf-8", "Fora do diretório público.");
        return;
    }

    try {
        const conteudo = await readFile(alvo);
        resposta.writeHead(200, {
            "Content-Type": TIPOS[extname(alvo)] ?? "application/octet-stream",
            "Content-Length": conteudo.length,
            // O painel troca a cada build; cache aqui só atrapalha a depuração.
            "Cache-Control": "no-cache"
        });
        resposta.end(conteudo);
    } catch {
        responder(resposta, 404, "text/plain; charset=utf-8", "Não existe aqui.");
    }
}

/**
 * Repassa para a API do salão. O `Authorization` que entra é descartado e o
 * nosso é posto no lugar — o navegador não escolhe com que credencial fala
 * com o serviço.
 */
function repassar(
    requisicao: IncomingMessage,
    resposta: ServerResponse,
    caminho: string,
    config: Configuracao
): void {
    const alvo = new URL(caminho.replace(/^\/api/, "") || "/", config.api);

    const cabecalhos: Record<string, string> = {};
    const tipo = requisicao.headers["content-type"];
    if (typeof tipo === "string") {
        cabecalhos["content-type"] = tipo;
    }
    if (config.autorizacao !== null) {
        cabecalhos["authorization"] = config.autorizacao;
    }

    const upstream = pedirAoServico(
        {
            protocol: alvo.protocol,
            hostname: alvo.hostname,
            port: alvo.port,
            path: `${alvo.pathname}${alvo.search}`,
            method: requisicao.method ?? "GET",
            headers: cabecalhos
        },
        (doServico) => {
            resposta.writeHead(doServico.statusCode ?? 502, {
                "Content-Type": doServico.headers["content-type"] ?? "application/json; charset=utf-8"
            });
            doServico.pipe(resposta);
        }
    );

    upstream.on("error", () => {
        if (!resposta.headersSent) {
            responder(
                resposta,
                502,
                "application/json; charset=utf-8",
                JSON.stringify({
                    erro: { tipo: "ServicoIndisponivel", mensagem: "O serviço do salão não respondeu." }
                })
            );
        }
    });

    requisicao.pipe(upstream);
}

function iniciar(): void {
    const config = lerConfiguracao();

    const servidor = createServer((requisicao, resposta) => {
        const caminho = new URL(requisicao.url ?? "/", "http://local").pathname;

        if (caminho === "/api" || caminho.startsWith("/api/")) {
            repassar(requisicao, resposta, requisicao.url ?? "/", config);
            return;
        }

        if (requisicao.method !== "GET" && requisicao.method !== "HEAD") {
            responder(resposta, 405, "text/plain; charset=utf-8", "Só GET aqui.");
            return;
        }

        void servirEstatico(caminho, resposta);
    });

    servidor.listen(config.porta, () => {
        process.stdout.write(
            `painel em http://localhost:${config.porta} — api em ${config.api.origin}` +
                `${config.autorizacao === null ? " (sem token)" : ""}\n`
        );
    });

    const encerrar = (): void => {
        servidor.close(() => process.exit(0));
        setTimeout(() => process.exit(1), 5_000).unref();
    };
    process.on("SIGINT", encerrar);
    process.on("SIGTERM", encerrar);
}

try {
    iniciar();
} catch (erro) {
    process.stderr.write(`${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exitCode = 1;
}
