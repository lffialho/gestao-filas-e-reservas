import {
    createServer,
    request as pedirAoServico,
    type IncomingMessage,
    type ServerResponse
} from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { paginaDeCriarSenha, paginaDeEntrada, paginaDeTrocarSenha } from "./entrar.js";
import {
    chaveDeSessao,
    type Credencial,
    criarCredencial,
    gravarCredencial,
    lerCredencial,
    MINIMO_DE_CARACTERES,
    senhaConfere,
    SenhaInvalida
} from "./credencial.js";
import {
    cabecalhoDoCookie,
    cabecalhoParaSair,
    criarSessao,
    DURACAO_EM_HORAS,
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
    /** Onde a senha do painel fica guardada, como hash. */
    arquivoDeSenha: string;
    /** Só com PAINEL_SEM_SENHA=1, que é para desenvolvimento. */
    semSenha: boolean;
}

/**
 * Onde a senha do painel mora.
 *
 * Ao lado do `.env` por padrão, que é a pasta do projeto — o mesmo lugar de
 * onde o painel já roda. `PAINEL_SEM_SENHA=1` abre tudo, e é só para
 * desenvolvimento: a linha de subida diz isso em voz alta.
 */
function arquivoDeSenha(): string {
    const escolhido = process.env["PAINEL_SENHA_ARQUIVO"];
    if (escolhido !== undefined && escolhido.trim() !== "") {
        return resolve(escolhido.trim());
    }
    return join(AQUI, "..", "painel-senha.json");
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

    const comum = {
        porta,
        api,
        arquivoDeSenha: arquivoDeSenha(),
        semSenha: process.env["PAINEL_SEM_SENHA"] === "1"
    };

    const token = process.env["SALAO_TOKEN"];
    if (token !== undefined && token.trim() !== "") {
        return { ...comum, autorizacao: `Bearer ${token.trim()}` };
    }
    if (process.env["SALAO_SEM_AUTENTICACAO"] === "1") {
        return { ...comum, autorizacao: null };
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

const HTML = "text/html; charset=utf-8";

function entregarSessao(resposta: ServerResponse, credencial: Credencial, destino: string): void {
    resposta.writeHead(303, {
        Location: destino,
        "Set-Cookie": cabecalhoDoCookie(criarSessao(chaveDeSessao(credencial)), DURACAO_EM_HORAS * 60 * 60)
    });
    resposta.end();
}

async function camposDoFormulario(requisicao: IncomingMessage): Promise<URLSearchParams | null> {
    try {
        return await lerFormulario(requisicao);
    } catch {
        return null;
    }
}

/**
 * A primeira abertura: criar a senha.
 *
 * Só existe enquanto não há senha nenhuma. Depois de criada, este caminho passa
 * a mandar para `/entrar` — senão seria uma porta para trocar a senha de quem
 * já tem uma, sem saber a antiga.
 */
async function tratarCriacao(
    requisicao: IncomingMessage,
    resposta: ServerResponse,
    config: Configuracao
): Promise<void> {
    if (requisicao.method === "GET" || requisicao.method === "HEAD") {
        responder(resposta, 200, HTML, paginaDeCriarSenha(null));
        return;
    }
    if (requisicao.method !== "POST") {
        responder(resposta, 405, "text/plain; charset=utf-8", "Só GET e POST aqui.");
        return;
    }

    const campos = await camposDoFormulario(requisicao);
    if (campos === null) {
        responder(resposta, 400, HTML, paginaDeCriarSenha("Pedido inválido."));
        return;
    }

    const senha = campos.get("senha") ?? "";
    if (senha !== (campos.get("repetida") ?? "")) {
        responder(resposta, 400, HTML, paginaDeCriarSenha("As duas senhas não são iguais."));
        return;
    }

    let credencial: Credencial;
    try {
        credencial = criarCredencial(senha);
    } catch (erro) {
        const recado =
            erro instanceof SenhaInvalida
                ? erro.message
                : `A senha precisa de pelo menos ${MINIMO_DE_CARACTERES} caracteres.`;
        responder(resposta, 400, HTML, paginaDeCriarSenha(recado));
        return;
    }

    try {
        gravarCredencial(config.arquivoDeSenha, credencial);
    } catch {
        // Sem poder gravar, aceitar a senha seria mentira: ela sumiria no
        // próximo reinício e ninguém entenderia por quê.
        responder(
            resposta,
            500,
            HTML,
            paginaDeCriarSenha(
                `Não consegui gravar em ${config.arquivoDeSenha}. Confira a permissão da pasta.`
            )
        );
        return;
    }

    process.stdout.write(`${new Date().toISOString()} senha do painel criada
`);
    entregarSessao(resposta, credencial, "/");
}

async function tratarEntrada(
    requisicao: IncomingMessage,
    resposta: ServerResponse,
    credencial: Credencial
): Promise<void> {
    if (requisicao.method === "GET" || requisicao.method === "HEAD") {
        responder(resposta, 200, HTML, paginaDeEntrada(null));
        return;
    }
    if (requisicao.method !== "POST") {
        responder(resposta, 405, "text/plain; charset=utf-8", "Só GET e POST aqui.");
        return;
    }

    const campos = await camposDoFormulario(requisicao);
    if (campos === null) {
        responder(resposta, 400, HTML, paginaDeEntrada("Pedido inválido."));
        return;
    }

    if (!senhaConfere(campos.get("senha") ?? "", credencial)) {
        await esperarUmPouco();
        process.stdout.write(`${new Date().toISOString()} senha errada no painel
`);
        responder(resposta, 401, HTML, paginaDeEntrada("Senha errada."));
        return;
    }

    entregarSessao(resposta, credencial, "/");
}

/**
 * Trocar a senha, sabendo a atual.
 *
 * Exigir a senha atual mesmo de quem já está logado é o que impede que um
 * tablet deixado aberto no balcão vire a troca da senha da casa. E como a chave
 * das sessões sai do hash, trocar a senha derruba as sessões de todo o resto —
 * inclusive a de quem trocou, que recebe uma nova aqui mesmo.
 */
async function tratarTroca(
    requisicao: IncomingMessage,
    resposta: ServerResponse,
    credencial: Credencial,
    config: Configuracao
): Promise<void> {
    if (requisicao.method === "GET" || requisicao.method === "HEAD") {
        responder(resposta, 200, HTML, paginaDeTrocarSenha(null, false));
        return;
    }
    if (requisicao.method !== "POST") {
        responder(resposta, 405, "text/plain; charset=utf-8", "Só GET e POST aqui.");
        return;
    }

    const campos = await camposDoFormulario(requisicao);
    if (campos === null) {
        responder(resposta, 400, HTML, paginaDeTrocarSenha("Pedido inválido.", false));
        return;
    }

    if (!senhaConfere(campos.get("atual") ?? "", credencial)) {
        await esperarUmPouco();
        responder(resposta, 401, HTML, paginaDeTrocarSenha("A senha atual não confere.", false));
        return;
    }

    const nova = campos.get("senha") ?? "";
    if (nova !== (campos.get("repetida") ?? "")) {
        responder(resposta, 400, HTML, paginaDeTrocarSenha("As duas senhas novas não são iguais.", false));
        return;
    }

    let trocada: Credencial;
    try {
        trocada = criarCredencial(nova);
    } catch (erro) {
        const recado =
            erro instanceof SenhaInvalida
                ? erro.message
                : `A senha precisa de pelo menos ${MINIMO_DE_CARACTERES} caracteres.`;
        responder(resposta, 400, HTML, paginaDeTrocarSenha(recado, false));
        return;
    }

    try {
        gravarCredencial(config.arquivoDeSenha, trocada);
    } catch {
        responder(
            resposta,
            500,
            HTML,
            paginaDeTrocarSenha(`Não consegui gravar em ${config.arquivoDeSenha}.`, false)
        );
        return;
    }

    process.stdout.write(`${new Date().toISOString()} senha do painel trocada
`);
    entregarSessao(resposta, trocada, "/");
}

function ehApi(caminho: string): boolean {
    return caminho === "/api" || caminho.startsWith("/api/");
}

/**
 * Barra quem não pode passar.
 *
 * A API responde em JSON, para o painel saber reagir; o resto manda a pessoa
 * para a tela certa. Devolver HTML a um `fetch` faria o painel mostrar "erro
 * desconhecido" no lugar de pedir a senha.
 */
function recusar(resposta: ServerResponse, caminho: string, destino: string): void {
    if (ehApi(caminho)) {
        responder(
            resposta,
            401,
            "application/json; charset=utf-8",
            JSON.stringify({
                erro: { tipo: "PainelNaoAutenticado", mensagem: "Entre no painel de novo." }
            })
        );
        return;
    }
    resposta.writeHead(303, { Location: destino });
    resposta.end();
}

/** Enquanto não há senha, o painel inteiro é a tela de criá-la. */
function portaoSemSenhaAinda(
    requisicao: IncomingMessage,
    resposta: ServerResponse,
    caminho: string,
    config: Configuracao
): boolean {
    if (caminho === "/criar-senha") {
        void tratarCriacao(requisicao, resposta, config);
        return true;
    }
    recusar(resposta, caminho, "/criar-senha");
    return true;
}

/**
 * O portão: resolve tudo que diz respeito a criar senha, entrar, trocar e sair.
 *
 * Devolve `true` quando já respondeu — aí não há mais o que atender. Separado
 * de `atender` porque são duas decisões diferentes, "esta pessoa pode?" e "o
 * que ela pediu?", e juntá-las passava do limite de complexidade do Biome.
 *
 * A credencial é lida do disco a cada pedido. A um punhado de leituras por
 * segundo, que é o que um painel faz, o custo é irrelevante — e em troca
 * trocar a senha vale na hora, e apagar o arquivo devolve o painel à primeira
 * abertura sem precisar reiniciar nada.
 */
function portao(
    requisicao: IncomingMessage,
    resposta: ServerResponse,
    caminho: string,
    config: Configuracao
): boolean {
    if (config.semSenha) {
        return false;
    }

    const credencial = lerCredencial(config.arquivoDeSenha);
    if (credencial === null) {
        return portaoSemSenhaAinda(requisicao, resposta, caminho, config);
    }

    if (caminho === "/sair") {
        resposta.writeHead(303, { Location: "/entrar", "Set-Cookie": cabecalhoParaSair() });
        resposta.end();
        return true;
    }

    // Já há senha: criar de novo seria trocá-la sem saber a antiga.
    if (caminho === "/criar-senha") {
        resposta.writeHead(303, { Location: "/entrar" });
        resposta.end();
        return true;
    }

    if (caminho === "/entrar") {
        void tratarEntrada(requisicao, resposta, credencial);
        return true;
    }

    const autenticado = sessaoValida(
        lerCookie(requisicao.headers.cookie, NOME_DO_COOKIE),
        chaveDeSessao(credencial)
    );

    if (caminho === "/trocar-senha") {
        if (autenticado) {
            void tratarTroca(requisicao, resposta, credencial, config);
        } else {
            recusar(resposta, caminho, "/entrar");
        }
        return true;
    }

    if (autenticado) {
        return false;
    }

    recusar(resposta, caminho, "/entrar");
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

        if (!portao(requisicao, resposta, caminho, config)) {
            atender(requisicao, resposta, caminho, config);
        }
    });

    servidor.listen(config.porta, () => {
        process.stdout.write(
            `painel em http://localhost:${config.porta} — api em ${config.api.origin}` +
                `${config.autorizacao === null ? " (sem token)" : ""}` +
                `${config.semSenha ? " — SEM SENHA, aberto a quem alcançar esta porta" : ""}` +
                `${!config.semSenha && lerCredencial(config.arquivoDeSenha) === null ? " — primeira abertura: crie a senha" : ""}\n`
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
