import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Cliente } from "../dominio/entidades/cliente.js";
import { Mesa } from "../dominio/entidades/mesa.js";
import { DadosInvalidos } from "../dominio/erros.js";
import type { Periodo } from "../dominio/eventos.js";
import type { MotorGerente } from "../dominio/servicos/motor-gerente.js";
import { descreverErro, registradorSilencioso, type Registrador } from "../compartilhado/log/registrador.js";
import { mascararCaminho } from "../compartilhado/log/mascarar.js";
import { autenticadorAberto, type Autenticador } from "./autenticacao.js";
import { traduzirErro } from "./erros-http.js";
import { itemFilaJson, liberacaoJson, recepcaoJson, reservaJson } from "./representacoes.js";

/** Teto do corpo da requisição: sem isso um cliente pode esgotar a memória. */
const LIMITE_DO_CORPO_EM_BYTES = 64 * 1024;

/** Quantos eventos `/eventos` devolve quando ninguém pede um número. */
const EVENTOS_POR_PADRAO = 50;

/** Teto de `limite`. Quem quer o dia inteiro pede o resumo, que já vem somado. */
const TETO_DE_EVENTOS = 500;

type Corpo = Record<string, unknown>;

interface Resposta {
    status: number;
    corpo: unknown;
}

interface Contexto {
    parametros: Record<string, string>;
    corpo: Corpo;
    /** Parâmetros depois do `?`. Hoje só o relatório usa. */
    consulta: URLSearchParams;
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

/** Instante ISO 8601 vindo da query. O fuso é decidido por quem chama. */
function instante(consulta: URLSearchParams, campo: string): Date {
    const bruto = consulta.get(campo);
    if (bruto === null || bruto.trim() === "") {
        throw new DadosInvalidos(`O parâmetro "${campo}" é obrigatório, em ISO 8601.`);
    }
    const data = new Date(bruto);
    if (Number.isNaN(data.getTime())) {
        throw new DadosInvalidos(`O parâmetro "${campo}" não é uma data ISO 8601: "${bruto}".`);
    }
    return data;
}

/** Período `[de, ate)` vindo da query. Quem chama é que sabe onde começa o dia. */
function periodoDe(consulta: URLSearchParams): Periodo {
    const inicio = instante(consulta, "de");
    const fim = instante(consulta, "ate");
    if (fim.getTime() <= inicio.getTime()) {
        throw new DadosInvalidos('O parâmetro "ate" tem de ser depois de "de".');
    }
    return { inicio, fim };
}

/** `limite` da query, opcional. Fora da faixa é erro — corrigir calado esconde bug. */
function limiteDe(consulta: URLSearchParams): number {
    const bruto = consulta.get("limite");
    if (bruto === null || bruto.trim() === "") {
        return EVENTOS_POR_PADRAO;
    }
    const valor = Number(bruto);
    if (!Number.isInteger(valor) || valor < 1 || valor > TETO_DE_EVENTOS) {
        throw new DadosInvalidos(`O parâmetro "limite" deve ser um inteiro entre 1 e ${TETO_DE_EVENTOS}.`);
    }
    return valor;
}

/** Tamanho do grupo vindo da query, para a prévia da recepção. */
function pessoasDaConsulta(consulta: URLSearchParams): number {
    const bruto = consulta.get("pessoas");
    const valor = Number(bruto);
    if (bruto === null || bruto.trim() === "" || !Number.isInteger(valor) || valor < 1) {
        throw new DadosInvalidos('O parâmetro "pessoas" é obrigatório e deve ser um inteiro positivo.');
    }
    return valor;
}

function clienteDoCorpo(corpo: Corpo): Cliente {
    return new Cliente(texto(corpo, "nome"), inteiro(corpo, "pessoas"), texto(corpo, "telefone"));
}

// --------------------------------------------------------------------------

function rotas(
    motor: MotorGerente,
    backup: () => SaudeDoBackup | null,
    pulso: () => SaudeDoPulso | null
): Rota[] {
    const rota = (metodo: string, caminho: string, manipular: Manipulador): Rota => ({
        metodo,
        segmentos: caminho.split("/").filter((s) => s !== ""),
        manipular
    });

    return [
        /**
         * Saúde do serviço — e do backup.
         *
         * O backup entra aqui porque **falha de backup é silenciosa**: o salão
         * segue atendendo, ninguém percebe, e a casa descobre no dia em que
         * precisa da cópia. Quem monitora olha uma rota só.
         */
        {
            ...rota("GET", "/saude", async () => ({
                status: 200,
                corpo: { status: "ok", backup: backup(), pulso: pulso() }
            })),
            aberta: true
        },

        rota("GET", "/salao", async () => ({
            status: 200,
            corpo: await motor.gerarRelatorio()
        })),

        /**
         * Fechamento do período. As bordas vêm de quem chama, em ISO: só o
         * cliente sabe onde começa "hoje" no fuso do restaurante.
         */
        rota("GET", "/relatorio", async ({ consulta }) => ({
            status: 200,
            corpo: await motor.resumirPeriodo(periodoDe(consulta))
        })),

        /**
         * O diário cru, do mais recente para o mais antigo — a ordem em que se
         * lê um diário aberto no balcão.
         *
         * `limite` corta a resposta, não a leitura: o repositório lê o período
         * inteiro de qualquer jeito, e o corte existe para o painel não
         * arrastar o dia todo a cada atualização.
         */
        rota("GET", "/eventos", async ({ consulta }) => {
            const limite = limiteDe(consulta);
            const todos = await motor.eventos(periodoDe(consulta));
            const recentesPrimeiro = [...todos].sort((a, b) => b.momento.localeCompare(a.momento));
            return {
                status: 200,
                corpo: { itens: recentesPrimeiro.slice(0, limite), total: todos.length }
            };
        }),

        rota("GET", "/fila", async () => ({
            status: 200,
            corpo: { itens: (await motor.consultarFila()).map(itemFilaJson) }
        })),

        /** Cadastra a mesa. Se alguém da fila couber nela, já sai sentado. */
        rota("POST", "/mesas", async ({ corpo }) => {
            const mesa = new Mesa(texto(corpo, "id"), inteiro(corpo, "numero"), inteiro(corpo, "capacidade"));
            const { mesa: criada } = await motor.adicionarMesa(mesa);
            return { status: 201, corpo: criada };
        }),

        /**
         * O direito ao esquecimento (LGPD): tira nome e telefone deste cliente
         * do diário. Os números do relatório ficam — o atendimento aconteceu.
         *
         * `DELETE` e não `POST` porque o efeito é apagar, e responde 200 mesmo
         * quando não havia nada: quem pede para ser esquecido não precisa
         * descobrir, pela resposta, se estava ou não no cadastro.
         */
        rota("DELETE", "/clientes/:telefone", async ({ parametros }) => ({
            status: 200,
            corpo: await motor.esquecerCliente(parametros["telefone"] ?? "")
        })),

        /** Tira a mesa da planta. Mesa ocupada ou já chamada não sai. */
        rota("DELETE", "/mesas/:id", async ({ parametros }) => ({
            status: 200,
            corpo: await motor.removerMesa(parametros["id"] ?? "")
        })),

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

        /**
         * Onde este grupo iria parar, se chegasse agora. Leitura pura: nada
         * muda no salão, e a resposta sai do mesmo cálculo que `POST /chegadas`
         * faria — é para poder mostrar o destino a quem ainda está digitando
         * sem arriscar que a tela e o salão discordem.
         *
         * O telefone é opcional: sem ele a resposta considera só o tamanho do
         * grupo, que já é o suficiente na maior parte do preenchimento.
         */
        rota("GET", "/chegadas/previa", async ({ consulta }) => ({
            status: 200,
            corpo: await motor.preverRecepcao(pessoasDaConsulta(consulta), consulta.get("telefone"))
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

        /** Arrasta a mesa na planta. Não mexe em status nem em ocupante. */
        rota("POST", "/mesas/:id/posicao", async ({ parametros, corpo }) => ({
            status: 200,
            corpo: await motor.moverMesa(parametros["id"] ?? "", {
                coluna: inteiro(corpo, "coluna"),
                linha: inteiro(corpo, "linha")
            })
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

/**
 * O que `/saude` conta sobre o backup.
 *
 * Declarado aqui, e não importado de `infra/backup`: os dois são adaptadores, e
 * um não deve depender do outro. A tipagem estrutural casa sozinha com o que a
 * rotina devolve — se ela mudar de forma, isto deixa de compilar na composição,
 * que é onde o erro deve aparecer.
 */
export interface SaudeDoBackup {
    ultimaCopiaEm: string | null;
    ultimaFalha: string | null;
    falhasSeguidas: number;
    espelho: { ultimaCopiaEm: string | null; ultimaFalha: string | null } | null;
}

/** O que `/saude` conta sobre o pulso. Declarado aqui, como o do backup. */
export interface SaudeDoPulso {
    ultimoEnvioEm: string | null;
    ultimaFalha: string | null;
    falhasSeguidas: number;
}

export interface OpcoesDoServidor {
    /** Sem autenticador, a API fica aberta — só para desenvolvimento. */
    autenticador?: Autenticador | undefined;
    registrador?: Registrador | undefined;
    /**
     * Como anda o backup, para `/saude` contar. Sem isto, a rota só diz que o
     * processo responde — e um serviço de pé que parou de copiar o banco há
     * três dias responde igualzinho.
     */
    backup?: (() => SaudeDoBackup | null) | undefined;
    /** Como anda o "Sistema online" — o pulso que sai desta casa. */
    pulso?: (() => SaudeDoPulso | null) | undefined;
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
    consulta: URLSearchParams;
}

/**
 * Decide o que responder: roteia, autentica, lê o corpo e chama a rota.
 * Separado do manipulador para que este cuide só de E/S e de erro.
 */
/**
 * Segmentos do caminho, já percent-decodificados. Um telefone em E.164 chega
 * como `/fila/%2B5511999999999`, e é "+5511999999999" que o domínio conhece —
 * casar o segmento cru faria o cliente nunca sair da fila.
 */
function segmentosDe(caminho: string): string[] {
    return caminho
        .split("/")
        .filter((s) => s !== "")
        .map((segmento) => {
            try {
                return decodeURIComponent(segmento);
            } catch {
                throw new DadosInvalidos(`Segmento de caminho mal codificado: "${segmento}".`);
            }
        });
}

async function despachar(pedido: PedidoADespachar): Promise<RespostaComCabecalhos> {
    const { todas, autenticador, requisicao, metodo, caminho, consulta } = pedido;
    const segmentos = segmentosDe(caminho);

    // HEAD roteia como GET; quem suprime o corpo na resposta é o próprio
    // node:http. Sem isto todo health check por HEAD levaria 405.
    const metodoDaRota = metodo === "HEAD" ? "GET" : metodo;

    const { casamento, caminhoExiste, metodosAceitos } = casar(todas, metodoDaRota, segmentos);

    if (casamento === null) {
        if (caminhoExiste) {
            const permitidos = metodosAceitos.includes("GET") ? [...metodosAceitos, "HEAD"] : metodosAceitos;
            return {
                status: 405,
                cabecalhos: { Allow: permitidos.join(", ") },
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

    const corpo = metodoDaRota === "GET" || metodoDaRota === "DELETE" ? {} : await lerCorpo(requisicao);
    return casamento.rota.manipular({ parametros: casamento.parametros, corpo, consulta });
}

/**
 * Monta o servidor HTTP sobre o MotorGerente. Não escuta porta: quem chama
 * decide, o que deixa o servidor testável em porta efêmera.
 */
export function criarServidor(motor: MotorGerente, opcoes: OpcoesDoServidor = {}): Server {
    const todas = rotas(motor, opcoes.backup ?? (() => null), opcoes.pulso ?? (() => null));
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
                caminho: mascararCaminho(caminhoRegistrado),
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
                    caminho: url.pathname,
                    consulta: url.searchParams
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
                        caminho: mascararCaminho(caminhoRegistrado),
                        ...descreverErro(erro)
                    });
                }
                responder(resposta, traduzido.status, traduzido.corpo);
            }
        })();
    });
}
