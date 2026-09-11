import { criarRegistradorJson, descreverErro, type Registrador } from "./compartilhado/log/registrador.js";
import { Mesa } from "./dominio/entidades/mesa.js";
import type { Notificador } from "./dominio/portas/notificador.js";
import type { RepositorioDoSalao } from "./dominio/portas/repositorio-do-salao.js";
import { MotorGerente } from "./dominio/servicos/motor-gerente.js";
import { autenticadorAberto, autenticadorPorToken, type Autenticador } from "./http/autenticacao.js";
import { criarServidor } from "./http/servidor.js";
import { RepositorioDoSalaoEmMemoria } from "./infra/memoria/repositorio-do-salao-em-memoria.js";
import { NotificadorDeLog } from "./infra/notificacao/notificador-de-log.js";
import { NotificadorTwilio } from "./infra/notificacao/notificador-twilio.js";
import { RepositorioDoSalaoSqlite } from "./infra/sqlite/repositorio-do-salao-sqlite.js";

/**
 * Ponto de entrada do serviço.
 *
 * | Variável              | Padrão | Efeito                                          |
 * |-----------------------|--------|-------------------------------------------------|
 * | PORTA                 | 3000   | Porta HTTP                                      |
 * | SALAO_BANCO           | —      | Arquivo SQLite; sem ela, salão em memória       |
 * | SALAO_TOKEN           | —      | Token da equipe, exigido em toda rota menos /saude |
 * | SALAO_SEM_AUTENTICACAO| —      | "1" abre a API; só para desenvolvimento         |
 */

const MESAS_DE_ABERTURA = (): Mesa[] => [
    new Mesa("m1", 1, 2),
    new Mesa("m2", 2, 2),
    new Mesa("m3", 3, 4),
    new Mesa("m4", 4, 4),
    new Mesa("m5", 5, 6)
];

class ConfiguracaoInvalida extends Error {}

function lerPorta(): number {
    const bruto = process.env["PORTA"];
    if (bruto === undefined || bruto === "") {
        return 3000;
    }
    const porta = Number(bruto);
    if (!Number.isInteger(porta) || porta < 0 || porta > 65535) {
        throw new ConfiguracaoInvalida(`PORTA inválida: "${bruto}".`);
    }
    return porta;
}

/**
 * Sem token o serviço **não sobe**. Uma API que opera o salão aberta por
 * omissão é o tipo de padrão que só se descobre errado depois; abrir tem de
 * ser escolha declarada.
 */
function lerAutenticacao(registrador: Registrador): Autenticador {
    const token = process.env["SALAO_TOKEN"];

    if (token !== undefined && token.trim() !== "") {
        return autenticadorPorToken(token);
    }

    if (process.env["SALAO_SEM_AUTENTICACAO"] === "1") {
        registrador.aviso("autenticacao_desligada", {
            detalhe: "SALAO_SEM_AUTENTICACAO=1: qualquer um que alcance a porta opera o salão."
        });
        return autenticadorAberto;
    }

    throw new ConfiguracaoInvalida(
        "Defina SALAO_TOKEN com o token da equipe, ou SALAO_SEM_AUTENTICACAO=1 para abrir a API em desenvolvimento."
    );
}

function montarArmazenamento(): {
    repositorio: RepositorioDoSalao;
    descricao: string;
    fechar: () => void;
} {
    const caminho = process.env["SALAO_BANCO"];

    if (caminho === undefined || caminho === "") {
        return {
            repositorio: new RepositorioDoSalaoEmMemoria({ mesas: MESAS_DE_ABERTURA() }),
            descricao: "memória (estado perdido ao encerrar)",
            fechar: () => {}
        };
    }

    const sqlite = new RepositorioDoSalaoSqlite(caminho, { mesas: MESAS_DE_ABERTURA() });
    return {
        repositorio: sqlite,
        descricao: `SQLite em ${caminho}`,
        fechar: () => sqlite.fechar()
    };
}

const registrador = criarRegistradorJson({ contexto: { servico: "gestao-filas-e-reservas" } });

/**
 * Com credencial da Twilio, avisa de verdade; sem ela, registra no log. O
 * padrão é o log para que desenvolvimento e teste não dependam de provedor
 * externo nem gastem mensagem.
 */
function montarNotificador(): Notificador {
    const contaSid = process.env["TWILIO_ACCOUNT_SID"];
    const tokenDeAutenticacao = process.env["TWILIO_AUTH_TOKEN"];
    const remetente = process.env["TWILIO_REMETENTE"];

    if (
        contaSid === undefined ||
        tokenDeAutenticacao === undefined ||
        remetente === undefined ||
        contaSid === "" ||
        tokenDeAutenticacao === "" ||
        remetente === ""
    ) {
        registrador.aviso("notificacao_apenas_em_log", {
            detalhe:
                "Sem TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN e TWILIO_REMETENTE: quem sai da fila não recebe mensagem."
        });
        return new NotificadorDeLog(registrador);
    }

    const canal = process.env["TWILIO_CANAL"] === "whatsapp" ? "whatsapp" : "sms";
    const templateSid = process.env["TWILIO_TEMPLATE_SID"];

    if (canal === "whatsapp" && (templateSid === undefined || templateSid === "")) {
        registrador.aviso("whatsapp_sem_template", {
            detalhe:
                "Sem TWILIO_TEMPLATE_SID o aviso só chega dentro da janela de 24h do cliente. Em produção, registre um template."
        });
    }

    registrador.info("notificacao_pelo_provedor", {
        provedor: "twilio",
        canal,
        comTemplate: Boolean(templateSid)
    });

    return new NotificadorTwilio({
        contaSid,
        tokenDeAutenticacao,
        remetente,
        canal,
        templateSid,
        paisPadrao: process.env["SALAO_PAIS_PADRAO"] ?? "55",
        registrador
    });
}

function iniciar(): void {
    const porta = lerPorta();
    const autenticador = lerAutenticacao(registrador);
    const armazenamento = montarArmazenamento();
    const notificador = montarNotificador();

    const motor = new MotorGerente(armazenamento.repositorio, { notificador, registrador });
    const servidor = criarServidor(motor, { autenticador, registrador });

    servidor.listen(porta, () => {
        const endereco = servidor.address();
        registrador.info("servico_iniciado", {
            porta: typeof endereco === "object" && endereco !== null ? endereco.port : porta,
            armazenamento: armazenamento.descricao
        });
    });

    servidor.on("error", (erro: unknown) => {
        registrador.erro("servidor_falhou", descreverErro(erro));
        armazenamento.fechar();
        process.exitCode = 1;
    });

    /**
     * Encerra parando de aceitar conexões, esperando as em curso e só então
     * fechando o banco — fechar antes abortaria requisição que ainda responde.
     */
    let encerrando = false;

    const encerrar = (motivo: string): void => {
        if (encerrando) return;
        encerrando = true;

        registrador.info("encerrando", { motivo });
        servidor.close(() => {
            armazenamento.fechar();
            registrador.info("encerrado");
        });

        // Rede de segurança: se uma conexão não soltar, não ficamos presos.
        setTimeout(() => {
            registrador.erro("encerramento_forcado", { detalhe: "conexões não encerraram em 10s" });
            process.exit(1);
        }, 10_000).unref();
    };

    process.on("SIGINT", () => encerrar("SIGINT"));
    process.on("SIGTERM", () => encerrar("SIGTERM"));

    // Falha não tratada deixa o processo em estado desconhecido: registra e cai,
    // para que o supervisor suba um processo limpo em vez de seguir torto.
    process.on("unhandledRejection", (erro: unknown) => {
        registrador.erro("promise_rejeitada_sem_tratamento", descreverErro(erro));
        encerrar("unhandledRejection");
        process.exitCode = 1;
    });

    process.on("uncaughtException", (erro: unknown) => {
        registrador.erro("excecao_nao_capturada", descreverErro(erro));
        encerrar("uncaughtException");
        process.exitCode = 1;
    });
}

try {
    iniciar();
} catch (erro) {
    if (erro instanceof ConfiguracaoInvalida) {
        registrador.erro("configuracao_invalida", { erroMensagem: erro.message });
    } else {
        registrador.erro("falha_ao_iniciar", descreverErro(erro));
    }
    process.exitCode = 1;
}
