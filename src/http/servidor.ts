import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Cliente } from "../dominio/entidades/cliente.js";
import { Mesa } from "../dominio/entidades/mesa.js";
import { DadosInvalidos } from "../dominio/erros.js";
import type { MotorGerente } from "../dominio/servicos/motor-gerente.js";
import { descreverErro, registradorSilencioso, type Registrador } from "../compartilhado/log/registrador.js";
import { autenticadorAberto, type Autenticador } from "./autenticacao.js";
import { traduzirErro } from "./erros-http.js";
import { liberacaoJson, recepcaoJson, reservaJson } from "./representacoes.js";

/** Teto do corpo da requisição: sem isso um cliente pode esgotar a memória. */
const LIMITE_DO_CORPO_EM_BYTES = 64 * 1024;

type Corpo = Record<string, unknown>;

interface Resposta {
    status: number;
    corpo: unknown;
}

interface Contexto {
    parametros: Record<string, string>;
    corpo: Corpo;
}

type Manipulador = (ctx: Contexto) => Promise<Resposta>;

interface Rota {
    metodo: string;
    /** Segmentos do caminho; os que começam com ":" são parâmetros. */
    segmentos: readonly string[];
    manipular: Manipulador;
    /** Rota aberta dispensa token — só /saude, para health check. */
    aberta?: boolean;
}

// --------------------------------------------------------------------------
// Validação do corpo. O domínio valida regra de negócio; aqui se valida forma,
// para que um campo do tipo errado dê 400 e não 500.
// --------------------------------------------------------------------------

function texto(corpo: Corpo, campo: string): string {
    const valor = corpo[campo];
    if (typeof valor !== "string" || valor.trim() === "") {
        throw new DadosInvalidos(`O campo "${campo}" é obrigatório e deve ser um texto não vazio.`);
    }
    return valor;
}

function inteiro(corpo: Corpo, campo: string): number {
    const valor = corpo[campo];
    if (typeof valor !== "number" || !Number.isInteger(valor)) {
        throw new DadosInvalidos(`O campo "${campo}" é obrigatório e deve ser um número inteiro.`);
    }
    return valor;
}

function clienteDoCorpo(corpo: Corpo): Cliente {
    return new Cliente(texto(corpo, "nome"), inteiro(corpo, "pessoas"), texto(corpo, "telefone"));
}

// --------------------------------------------------------------------------

function rotas(motor: MotorGerente): Rota[] {
    const rota = (metodo: string, caminho: string, manipular: Manipulador): Rota => ({
        metodo,
        segmentos: caminho.split("/").filter((s) => s !== ""),
        manipular
    });

    return [
        { ...rota("GET", "/saude", async () => ({ status: 200, corpo: { status: "ok" } })), aberta: true },

        rota("GET", "/salao", async () => ({
            status: 200,
            corpo: await motor.gerarRelatorio()
        })),

        rota("POST", "/mesas", async ({ corpo }) => {
            const mesa = new Mesa(texto(corpo, "id"), inteiro(corpo, "numero"), inteiro(corpo, "capacidade"));
            await motor.adicionarMesa(mesa);
            return { status: 201, corpo: await motor.consultarMesa(mesa.id) };
        }),

        rota("GET", "/mesas/:id", async ({ parametros }) => {
            const mesa = await motor.consultarMesa(parametros["id"] ?? "");
            if (mesa === undefined) {
                return {
                    status: 404,
                    corpo: { erro: { tipo: "MesaNaoEncontrada", mensagem: "Mesa não encontrada." } }
                };
            }
            return { status: 200, corpo: mesa };
        }),

        /** Cliente chegou: o salão decide entre mesa e fila, por ordem de chegada. */
        rota("POST", "/chegadas", async ({ corpo }) => ({
            status: 201,
            corpo: recepcaoJson(await motor.receberCliente(clienteDoCorpo(corpo)))
        })),

        /** Desistência de quem estava na fila. */
        rota("DELETE", "/fila/:telefone", async ({ parametros }) => {
            const item = await motor.sairDaFila(parametros["telefone"] ?? "");
            if (item === null) {
                return {
                    status: 404,
                    corpo: {
                        erro: {
                            tipo: "ClienteNaoEstaNaFila",
                            mensagem: "Nenhum cliente na fila com este telefone."
                        }
                    }
                };
            }
            return { status: 200, corpo: { saiuDaFila: true } };
        }),

        /** O anfitrião senta alguém numa mesa escolhida a dedo. */
        rota("POST", "/mesas/:id/reserva", async ({ parametros, corpo }) => ({
            status: 201,
            corpo: reservaJson(await motor.fazerReserva(parametros["id"] ?? "", clienteDoCorpo(corpo)))
        })),

        rota("DELETE", "/mesas/:id/reserva", async ({ parametros }) => ({
            status: 200,
            corpo: liberacaoJson(await motor.cancelarReserva(parametros["id"] ?? ""))
        })),

        /** O grupo chegou à mesa e sentou. */
        rota("POST", "/mesas/:id/ocupacao", async ({ parametros }) => ({
            status: 200,
            corpo: await motor.ocuparMesa(parametros["id"] ?? "")
        })),

        /** O grupo foi embora: a mesa vira e o próximo da fila que couber assume. */
        rota("POST", "/mesas/:id/liberacao", async ({ parametros }) => ({
            status: 200,
            corpo: liberacaoJson(await motor.liberarMesa(parametros["id"] ?? ""))
        }))
    ];
}

interface Casamento {
    rota: Rota;
    parametros: Record<string, string>;
}

/**
 * Casa só o caminho, ignorando o método. Devolve os parâmetros extraídos, ou
 * `null` se não casar.
 */
function casarCaminho(rota: Rota, caminho: readonly string[]): Record<string, string> | null {
    if (rota.segmentos.length !== caminho.length) {
        return null;
    }

    const parametros: Record<string, string> = {};

    for (let i = 0; i < rota.segmentos.length; i++) {
        const esperado = rota.segmentos[i] ?? "";
        const recebido = caminho[i] ?? "";

        if (esperado.startsWith(":")) {
            parametros[esperado.slice(1)] = recebido;
        } else if (esperado !== recebido) {
            return null;
        }
    }

    return parametros;
}

/** Casa caminho e método. Distingue "não existe" (404) de "método errado" (405). */
function casar(
    todas: readonly Rota[],
    metodo: string,
    caminho: readonly string[]
): { casamento: Casamento | null; caminhoExiste: boolean; metodosAceitos: string[] } {
    const mesmoCaminho: Rota[] = [];

    for (const rota of todas) {
        const parametros = casarCaminho(rota, caminho);
        if (parametros === null) continue;

        mesmoCaminho.push(rota);

        if (rota.metodo === metodo) {
            return { casamento: { rota, parametros }, caminhoExiste: true, metodosAceitos: [] };
        }
    }

    return {
        casamento: null,
        caminhoExiste: mesmoCaminho.length > 0,
        metodosAceitos: mesmoCaminho.map((r) => r.metodo)
    };
}

async function lerCorpo(requisicao: IncomingMessage): Promise<Corpo> {
    const pedacos: Buffer[] = [];
    let total = 0;

    for await (const pedaco of requisicao) {
        const buffer = pedaco as Buffer;
        total += buffer.length;
        if (total > LIMITE_DO_CORPO_EM_BYTES) {
            throw new DadosInvalidos("Corpo da requisição excede o limite de 64 KB.");
        }
        pedacos.push(buffer);
    }

    const bruto = Buffer.concat(pedacos).toString("utf8").trim();
    if (bruto === "") {
        return {};
    }

    let analisado: unknown;
    try {
        analisado = JSON.parse(bruto);
    } catch {
        throw new DadosInvalidos("Corpo da requisição não é JSON válido.");
    }

    if (analisado === null || typeof analisado !== "object" || Array.isArray(analisado)) {
        throw new DadosInvalidos("Corpo da requisição deve ser um objeto JSON.");
    }
    return analisado as Corpo;
}

function responder(resposta: ServerResponse, status: number, corpo: unknown): void {
    const texto = corpo === undefined ? "" : JSON.stringify(corpo);
    resposta.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(texto)
    });
    resposta.end(texto);
}

export interface OpcoesDoServidor {
    /** Sem autenticador, a API fica aberta — só para desenvolvimento. */
    autenticador?: Autenticador | undefined;
    registrador?: Registrador | undefined;
}

interface RespostaComCabecalhos extends Resposta {
    cabecalhos?: Record<string, string>;
}

interface PedidoADespachar {
    todas: readonly Rota[];
    autenticador: Autenticador;
    requisicao: IncomingMessage;
    metodo: string;
    caminho: string;
}

/**
 * Decide o que responder: roteia, autentica, lê o corpo e chama a rota.
 * Separado do manipulador para que este cuide só de E/S e de erro.
 */
async function despachar(pedido: PedidoADespachar): Promise<RespostaComCabecalhos> {
    const { todas, autenticador, requisicao, metodo, caminho } = pedido;
    const segmentos = caminho.split("/").filter((s) => s !== "");

    const { casamento, caminhoExiste, metodosAceitos } = casar(todas, metodo, segmentos);

    if (casamento === null) {
        if (caminhoExiste) {
            return {
                status: 405,
                cabecalhos: { Allow: metodosAceitos.join(", ") },
                corpo: {
                    erro: { tipo: "MetodoNaoPermitido", mensagem: `${metodo} não é aceito neste recurso.` }
                }
            };
        }
        return {
            status: 404,
            corpo: { erro: { tipo: "RotaNaoEncontrada", mensagem: `Nada em ${caminho}.` } }
        };
    }

    // Autenticação depois do roteamento, para que 404 e 405 não exijam token —
    // mas antes de ler corpo ou produzir qualquer efeito.
    if (casamento.rota.aberta !== true && !autenticador.permite(requisicao)) {
        return {
            status: 401,
            cabecalhos: { "WWW-Authenticate": 'Bearer realm="salao"' },
            corpo: {
                erro: {
                    tipo: "NaoAutenticado",
                    mensagem: "Informe o token da equipe em Authorization: Bearer."
                }
            }
        };
    }

    const corpo = metodo === "GET" || metodo === "DELETE" ? {} : await lerCorpo(requisicao);
    return casamento.rota.manipular({ parametros: casamento.parametros, corpo });
}

/**
 * Monta o servidor HTTP sobre o MotorGerente. Não escuta porta: quem chama
 * decide, o que deixa o servidor testável em porta efêmera.
 */
export function criarServidor(motor: MotorGerente, opcoes: OpcoesDoServidor = {}): Server {
    const todas = rotas(motor);
    const autenticador = opcoes.autenticador ?? autenticadorAberto;
    const registrador = opcoes.registrador ?? registradorSilencioso;

    return createServer((requisicao, resposta) => {
        const comecou = process.hrtime.bigint();
        const metodo = requisicao.method ?? "GET";
        let caminhoRegistrado = requisicao.url ?? "/";

        resposta.on("finish", () => {
            const duracaoMs = Number(process.hrtime.bigint() - comecou) / 1e6;
            registrador.info("requisicao", {
                metodo,
                caminho: caminhoRegistrado,
                status: resposta.statusCode,
                duracaoMs: Math.round(duracaoMs * 100) / 100
            });
        });

        void (async () => {
            try {
                const url = new URL(requisicao.url ?? "/", "http://local");
                caminhoRegistrado = url.pathname;

                const resultado = await despachar({
                    todas,
                    autenticador,
                    requisicao,
                    metodo,
                    caminho: url.pathname
                });

                for (const [nome, valor] of Object.entries(resultado.cabecalhos ?? {})) {
                    resposta.setHeader(nome, valor);
                }
                responder(resposta, resultado.status, resultado.corpo);
            } catch (erro) {
                const traduzido = traduzirErro(erro);
                if (traduzido.inesperado) {
                    registrador.erro("requisicao_falhou", {
                        metodo,
                        caminho: caminhoRegistrado,
                        ...descreverErro(erro)
                    });
                }
                responder(resposta, traduzido.status, traduzido.corpo);
            }
        })();
    });
}
