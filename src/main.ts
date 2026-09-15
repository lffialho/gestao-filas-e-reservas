import { dirname, join, resolve } from "node:path";
import { criarRegistradorJson, descreverErro, type Registrador } from "./compartilhado/log/registrador.js";
import { Mesa } from "./dominio/entidades/mesa.js";
import { RotinaDeBackup } from "./infra/backup/rotina-de-backup.js";
import type { Notificador } from "./dominio/portas/notificador.js";
import type { RepositorioDoSalao } from "./dominio/portas/repositorio-do-salao.js";
import { MotorGerente } from "./dominio/servicos/motor-gerente.js";
import { autenticadorAberto, autenticadorPorToken, type Autenticador } from "./http/autenticacao.js";
import { criarServidor } from "./http/servidor.js";
import { RepositorioDoSalaoEmMemoria } from "./infra/memoria/repositorio-do-salao-em-memoria.js";
import { NotificadorDeLog } from "./infra/notificacao/notificador-de-log.js";
import { NotificadorWhatsApp } from "./infra/notificacao/notificador-whatsapp.js";
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
 * | SALAO_BACKUP          | —      | "0" desliga as cópias do banco                  |
 * | SALAO_BACKUP_PASTA    | backups/ ao lado do banco | Onde as cópias ficam |
 * | SALAO_BACKUP_HORAS    | 6      | De quantas em quantas horas copiar              |
 * | SALAO_BACKUP_COPIAS   | 28     | Quantas cópias guardar (28 × 6h ≈ uma semana)   |
 */

/**
 * Salão de abertura. As posições são escolhidas, não enfileiradas: mesa de
 * dois nas bordas, as maiores no miolo, com corredor no meio — a disposição
 * que um salão de verdade teria, e que a simulação mostra já na primeira vez.
 */
const MESAS_DE_ABERTURA = (): Mesa[] => [
    new Mesa("m1", 1, 2, { coluna: 1, linha: 1 }),
    new Mesa("m2", 2, 2, { coluna: 1, linha: 6 }),
    new Mesa("m3", 3, 4, { coluna: 5, linha: 2 }),
    new Mesa("m4", 4, 4, { coluna: 5, linha: 6 }),
    new Mesa("m5", 5, 6, { coluna: 9, linha: 4 })
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

function inteiroDoAmbiente(nome: string, padrao: number, minimo: number): number {
    const bruto = process.env[nome];
    if (bruto === undefined || bruto.trim() === "") {
        return padrao;
    }
    const valor = Number(bruto);
    if (!Number.isInteger(valor) || valor < minimo) {
        throw new ConfiguracaoInvalida(`${nome} inválida: "${bruto}" (inteiro ≥ ${minimo}).`);
    }
    return valor;
}

/**
 * A rotina de cópias do banco.
 *
 * **Ligada por padrão.** Quem esquece a variável não pode ficar sem backup —
 * esse é justamente o modo de falhar que a rotina existe para evitar. As cópias
 * vão para `backups/` ao lado do arquivo do banco, salvo indicação em
 * contrário, e `SALAO_BACKUP=0` desliga para quem realmente quiser.
 */
function montarBackup(repositorio: RepositorioDoSalaoSqlite, banco: string): RotinaDeBackup | null {
    if (process.env["SALAO_BACKUP"] === "0") {
        registrador.aviso("backup_desligado", {
            detalhe: "SALAO_BACKUP=0: o estado do salão não está sendo copiado."
        });
        return null;
    }

    return new RotinaDeBackup((destino) => repositorio.copiarPara(destino), {
        pasta: process.env["SALAO_BACKUP_PASTA"] ?? join(dirname(resolve(banco)), "backups"),
        aCadaHoras: inteiroDoAmbiente("SALAO_BACKUP_HORAS", 6, 1),
        copias: inteiroDoAmbiente("SALAO_BACKUP_COPIAS", 28, 1),
        registrador
    });
}

function montarArmazenamento(): {
    repositorio: RepositorioDoSalao;
    descricao: string;
    backup: RotinaDeBackup | null;
    fechar: () => void;
} {
    const caminho = process.env["SALAO_BANCO"];

    if (caminho === undefined || caminho === "") {
        return {
            repositorio: new RepositorioDoSalaoEmMemoria({ mesas: MESAS_DE_ABERTURA() }),
            descricao: "memória (estado perdido ao encerrar)",
            // Não há o que copiar de um salão que já se perde ao encerrar.
            backup: null,
            fechar: () => {}
        };
    }

    const sqlite = new RepositorioDoSalaoSqlite(caminho, { mesas: MESAS_DE_ABERTURA() });
    return {
        repositorio: sqlite,
        descricao: `SQLite em ${caminho}`,
        backup: montarBackup(sqlite, caminho),
        fechar: () => sqlite.fechar()
    };
}

const registrador = criarRegistradorJson({ contexto: { servico: "gestao-filas-e-reservas" } });

/**
 * Quem avisa o cliente de que a mesa saiu.
 *
 * Sem `WHATSAPP_TOKEN`, o aviso vai para o log — o salão funciona igual, e quem
 * chama o cliente é o maître, como sempre foi. Com as três variáveis
 * preenchidas, sai pelo WhatsApp oficial.
 *
 * Ligar isto **não** é só preencher variável: o número precisa estar na Cloud
 * API da Meta e o template precisa estar aprovado. O README explica o caminho.
 */
function montarNotificador(): Notificador {
    const token = process.env["WHATSAPP_TOKEN"];
    const numeroRemetenteId = process.env["WHATSAPP_NUMERO_ID"];

    if (token === undefined || token.trim() === "") {
        return new NotificadorDeLog(registrador);
    }
    if (numeroRemetenteId === undefined || numeroRemetenteId.trim() === "") {
        throw new ConfiguracaoInvalida(
            "WHATSAPP_TOKEN está definido, mas WHATSAPP_NUMERO_ID não. " +
                "Meio configurado avisaria ninguém e ninguém perceberia."
        );
    }

    registrador.info("aviso_por_whatsapp", { numeroRemetenteId });
    return new NotificadorWhatsApp({
        token: token.trim(),
        numeroRemetenteId: numeroRemetenteId.trim(),
        template: process.env["WHATSAPP_TEMPLATE"] ?? "mesa_pronta",
        idioma: process.env["WHATSAPP_IDIOMA"] ?? "pt_BR",
        versao: process.env["WHATSAPP_VERSAO"]
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

        // Depois de a porta abrir: a primeira cópia não pode atrasar o salão
        // a subir, e se a pasta estiver ruim o serviço atende mesmo assim.
        armazenamento.backup?.iniciar();
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
        armazenamento.backup?.parar();

        servidor.close(() => {
            // Uma última cópia antes de fechar, quando dá: num encerramento
            // gracioso ela é a mais recente que existe.
            //
            // **No Windows quase nunca dá.** Parar a tarefa no Agendador, ou
            // qualquer supervisor, encerra o processo sem entregar sinal
            // nenhum — medido: SIGTERM e SIGINT matam sem passar por aqui, e
            // SIGBREAK e SIGHUP nem matam. Então esta cópia é um bônus do
            // caminho gracioso, e não a garantia: quem garante é a cópia
            // periódica, que não depende de o encerramento ser educado.
            armazenamento.backup?.agora();
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
