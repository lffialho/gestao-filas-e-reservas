import {
    createServer,
    request as pedirAoServico,
    type IncomingMessage,
    type ServerResponse
} from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { paginaDeEntrada } from "./entrar.js";
import {
    cabecalhoDoCookie,
    cabecalhoParaSair,
    criarSessao,
    DURACAO_EM_HORAS,
    iguaisEmTempoConstante,
    lerCookie,
    NOME_DO_COOKIE,
    sessaoValida
} from "./sessao.js";

/**
 * Servidor do painel. Faz três coisas, e só elas.
 *
 * Serve os arquivos de `publico/`, repassa `/api/...` para a API do salão
 * **pondo o token aqui**, e exige uma senha antes de qualquer uma das duas.
 *
 * O token ficar deste lado é a razão de o front ter um processo próprio:
 * `SALAO_TOKEN` é segredo único da equipe, e em JavaScript de navegador
 * qualquer um que abra o devtools libera todas as mesas do salão.
 *
 * Mas esconder o token do navegador cria a outra ponta do problema: como é o
 * painel que carrega a credencial, **quem alcança o painel manda no salão** sem
 * precisar de token. E o painel escuta na rede de propósito — é assim que o
 * tablet do balcão o abre. Sem senha, qualquer um no wifi do restaurante senta
 * gente e fecha o dia. Daí a sessão: ver `sessao.ts`.
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
    /** `null` só com PAINEL_SEM_SENHA=1, que é para desenvolvimento. */
    senha: string | null;
}

/**
 * A senha do painel.
 *
 * **Exigida por padrão**, como o token do serviço. Quem esquece de configurar
 * não pode acabar com um painel aberto na rede sem perceber — esse é justamente
 * o modo de falhar que a senha existe para evitar, e ele é silencioso: o painel
 * sobe, funciona, e só não pede nada a ninguém.
 */
function lerSenha(): string | null {
    const senha = process.env["PAINEL_SENHA"];
    if (senha !== undefined && senha.trim() !== "") {
        return senha.trim();
    }
    if (process.env["PAINEL_SEM_SENHA"] === "1") {
        return null;
    }
    throw new ConfiguracaoInvalida(
        "Defina PAINEL_SENHA com a senha do painel, ou PAINEL_SEM_SENHA=1 em desenvolvimento.\n" +
            "Sem isso, qualquer um na rede do restaurante abre o painel e manda no salão."
    );
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

    const senha = lerSenha();

    const token = process.env["SALAO_TOKEN"];
    if (token !== undefined && token.trim() !== "") {
        return { porta, api, autorizacao: `Bearer ${token.trim()}`, senha };
    }
    if (process.env["SALAO_SEM_AUTENTICACAO"] === "1") {
        return { porta, api, autorizacao: null, senha };
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

/** Lê o corpo de um POST de formulário. Pequeno por natureza; teto por garantia. */
async function lerFormulario(requisicao: IncomingMessage): Promise<URLSearchParams> {
    const pedacos: Buffer[] = [];
    let tamanho = 0;

    for await (const pedaco of requisicao) {
        tamanho += (pedaco as Buffer).length;
        if (tamanho > 4096) {
            throw new Error("Formulário grande demais.");
        }
        pedacos.push(pedaco as Buffer);
    }
    return new URLSearchParams(Buffer.concat(pedacos).toString("utf8"));
}

/**
 * Espera um instante antes de responder a uma senha errada.
 *
 * Não é proteção de verdade contra força bruta — para isso a senha precisa ser
 * boa. É o que transforma "milhares de tentativas por segundo" em "algumas por
 * segundo", o suficiente para que tentar adivinhar de um celular no wifi deixe
 * de ser prático e apareça no log antes de dar certo.
 */
function esperarUmPouco(): Promise<void> {
    return new Promise((pronto) => setTimeout(pronto, 400));
}

async function tratarEntrada(
    requisicao: IncomingMessage,
    resposta: ServerResponse,
    senha: string
): Promise<void> {
    if (requisicao.method === "GET" || requisicao.method === "HEAD") {
        responder(resposta, 200, TIPOS[".html"] ?? "text/html", paginaDeEntrada(null));
        return;
    }

    if (requisicao.method !== "POST") {
        responder(resposta, 405, "text/plain; charset=utf-8", "Só GET e POST aqui.");
        return;
    }

    let campos: URLSearchParams;
    try {
        campos = await lerFormulario(requisicao);
    } catch {
        responder(resposta, 400, TIPOS[".html"] ?? "text/html", paginaDeEntrada("Pedido inválido."));
        return;
    }

    if (!iguaisEmTempoConstante(campos.get("senha") ?? "", senha)) {
        await esperarUmPouco();
        process.stdout.write(`${new Date().toISOString()} senha errada no painel\n`);
        responder(resposta, 401, TIPOS[".html"] ?? "text/html", paginaDeEntrada("Senha errada."));
        return;
    }

    resposta.writeHead(303, {
        Location: "/",
        "Set-Cookie": cabecalhoDoCookie(criarSessao(senha), DURACAO_EM_HORAS * 60 * 60)
    });
    resposta.end();
}

function ehApi(caminho: string): boolean {
    return caminho === "/api" || caminho.startsWith("/api/");
}

/**
 * O portão: resolve tudo que diz respeito a entrar e sair.
 *
 * Devolve `true` quando já respondeu — aí não há mais o que atender. Separado
 * de `atender` porque misturar as duas coisas numa função só passava do limite
 * de complexidade do Biome, e o limite estava certo: são duas decisões
 * diferentes, "esta pessoa pode?" e "o que ela pediu?".
 */
function portao(
    requisicao: IncomingMessage,
    resposta: ServerResponse,
    caminho: string,
    senha: string | null
): boolean {
    if (caminho === "/sair") {
        resposta.writeHead(303, { Location: "/entrar", "Set-Cookie": cabecalhoParaSair() });
        resposta.end();
        return true;
    }

    if (senha === null) {
        return false;
    }

    if (caminho === "/entrar") {
        void tratarEntrada(requisicao, resposta, senha);
        return true;
    }

    if (sessaoValida(lerCookie(requisicao.headers.cookie, NOME_DO_COOKIE), senha)) {
        return false;
    }

    // A API responde em JSON, para o painel saber reagir; o resto manda a
    // pessoa para a tela de entrada. Devolver HTML a um fetch faria o painel
    // mostrar "erro desconhecido" no lugar de pedir a senha.
    if (ehApi(caminho)) {
        responder(
            resposta,
            401,
            "application/json; charset=utf-8",
            JSON.stringify({
                erro: { tipo: "PainelNaoAutenticado", mensagem: "Entre no painel de novo." }
            })
        );
        return true;
    }

    resposta.writeHead(303, { Location: "/entrar" });
    resposta.end();
    return true;
}

function atender(
    requisicao: IncomingMessage,
    resposta: ServerResponse,
    caminho: string,
    config: Configuracao
): void {
    if (ehApi(caminho)) {
        repassar(requisicao, resposta, requisicao.url ?? "/", config);
        return;
    }

    if (requisicao.method !== "GET" && requisicao.method !== "HEAD") {
        responder(resposta, 405, "text/plain; charset=utf-8", "Só GET aqui.");
        return;
    }

    void servirEstatico(caminho, resposta);
}

function iniciar(): void {
    const config = lerConfiguracao();

    const servidor = createServer((requisicao, resposta) => {
        const caminho = new URL(requisicao.url ?? "/", "http://local").pathname;

        if (!portao(requisicao, resposta, caminho, config.senha)) {
            atender(requisicao, resposta, caminho, config);
        }
    });

    servidor.listen(config.porta, () => {
        process.stdout.write(
            `painel em http://localhost:${config.porta} — api em ${config.api.origin}` +
                `${config.autorizacao === null ? " (sem token)" : ""}` +
                `${config.senha === null ? " — SEM SENHA, aberto a quem alcançar esta porta" : ""}\n`
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
