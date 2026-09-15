import { dirname, join, resolve } from "node:path";
import {
    criarRegistradorJson,
    descreverErro,
    type Nivel,
    type Registrador
} from "./compartilhado/log/registrador.js";
import { criarEscritorDeArquivo } from "./infra/log/arquivo-de-log.js";
import { Mesa } from "./dominio/entidades/mesa.js";
import { type EstadoDoBackup, RotinaDeBackup } from "./infra/backup/rotina-de-backup.js";
import { RotinaDePulso } from "./infra/pulso/rotina-de-pulso.js";
import type { Notificador } from "./dominio/portas/notificador.js";
import type { RepositorioDoSalao } from "./dominio/portas/repositorio-do-salao.js";
import { MotorGerente } from "./dominio/servicos/motor-gerente.js";
import { autenticadorAberto, autenticadorPorToken, type Autenticador } from "./http/autenticacao.js";
import { criarServidor } from "./http/servidor.js";
import { RepositorioDoSalaoEmMemoria } from "./infra/memoria/repositorio-do-salao-em-memoria.js";
import { NotificadorDeLog } from "./infra/notificacao/notificador-de-log.js";
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
 * | SALAO_BACKUP_ESPELHO  | —      | Segunda pasta das cópias; aponte para um OneDrive |
 * | SALAO_PULSO_URL       | —      | Para onde avisar que a casa está funcionando     |
 * | SALAO_PULSO_MINUTOS   | 5      | De quantos em quantos minutos avisar             |
 * | SALAO_CASA            | —      | Nome desta casa, para quem recebe o pulso        |
 * | SALAO_RETENCAO_DIAS   | 90     | Depois disso, nome e telefone saem do diário     |
 * | SALAO_LOG_ARQUIVO     | —      | Guarda o log também num arquivo, com rodízio      |
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
        espelho: process.env["SALAO_BACKUP_ESPELHO"],
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

/**
 * Para onde o log vai.
 *
 * Sempre para o stdout, que é o que se vê ao rodar na mão. Com
 * `SALAO_LOG_ARQUIVO`, também para um arquivo com rodízio — sem isso, rodando
 * como tarefa do Agendador o log se perde inteiro, e não há o que olhar quando
 * a casa liga dizendo que algo deu errado no sábado à noite.
 *
 * Nome e telefone já saem mascarados de quem os escreve, então o arquivo nasce
 * sem dado pessoal e pode ser mandado para quem dá suporte como está.
 */
function escritorDoLog(): ((linha: string, nivel: Nivel) => void) | undefined {
    const caminho = process.env["SALAO_LOG_ARQUIVO"];
    if (caminho === undefined || caminho.trim() === "") {
        return undefined;
    }

    const paraArquivo = criarEscritorDeArquivo({ caminho: caminho.trim() });
    return (linha, nivel) => {
        if (nivel === "erro") {
            process.stderr.write(`${linha}
`);
        } else {
            process.stdout.write(`${linha}
`);
        }
        paraArquivo(linha, nivel);
    };
}

// Uma vez só: cada escritor tem o próprio contador de tamanho, e dois deles
// fariam o rodízio acontecer na hora errada.
const escrever = escritorDoLog();

const registrador = criarRegistradorJson({
    contexto: { servico: "gestao-filas-e-reservas" },
    ...(escrever === undefined ? {} : { escrever })
});

/**
 * O aviso a quem sai da fila vai para o log. Para mandar mensagem de verdade,
 * implemente `Notificador` com o provedor escolhido e entregue aqui — o
 * domínio não muda.
 */
function montarNotificador(): Notificador {
    return new NotificadorDeLog(registrador);
}

/**
 * "Sistema online": o pulso que diz que esta casa está funcionando.
 *
 * Desligado sem `SALAO_PULSO_URL`. Aponte para um serviço que alerte quando o
 * sinal **para** de chegar — é o silêncio que interessa, não a mensagem.
 *
 * Vai junto a saúde do backup, porque as duas perguntas que se faz de longe são
 * "a casa está de pé?" e "a casa está copiando o banco?". Um salão no ar que
 * parou de copiar há três dias responde igualzinho a um saudável.
 *
 * **Contagens e horários, nada mais.** Nome e telefone de quem jantou aqui não
 * saem da casa: quem recebe o pulso é um terceiro.
 */
function montarPulso(estadoDoBackup: () => EstadoDoBackup | null): RotinaDePulso | null {
    const url = process.env["SALAO_PULSO_URL"];
    if (url === undefined || url.trim() === "") {
        return null;
    }

    return new RotinaDePulso({
        url: url.trim(),
        aCadaMinutos: inteiroDoAmbiente("SALAO_PULSO_MINUTOS", 5, 1),
        casa: process.env["SALAO_CASA"],
        registrador,
        resumo: () => {
            const backup = estadoDoBackup();
            if (backup === null) {
                return { backup: null };
            }
            // Sem o caminho do arquivo: quem monitora não precisa saber a
            // estrutura de pastas da casa, e o que não sai não vaza.
            return {
                backup: {
                    ultimaCopiaEm: backup.ultimaCopiaEm,
                    falhasSeguidas: backup.falhasSeguidas,
                    espelhoEm: backup.espelho?.ultimaCopiaEm ?? null
                }
            };
        }
    });
}

/**
 * Expurgo do dado pessoal antigo (LGPD).
 *
 * O diário é o registro do que aconteceu, **não um cadastro de clientes**.
 * Passado o tempo em que o nome serve para alguma coisa — conferir uma
 * reclamação, entender uma noite —, ele vira dado pessoal guardado sem motivo,
 * e a casa responde por isso.
 *
 * Anonimizar não custa nenhum número: mesa, capacidade, espera e permanência
 * não identificam ninguém e continuam ali. O relatório de seis meses atrás sai
 * igualzinho, só sem os nomes.
 *
 * Roda ao subir e uma vez por dia. `SALAO_RETENCAO_DIAS=0` desliga, para quem
 * tiver motivo declarado para guardar — a decisão é da casa, não nossa.
 */
function montarExpurgo(motor: MotorGerente): { iniciar: () => void; parar: () => void } {
    const dias = inteiroDoAmbiente("SALAO_RETENCAO_DIAS", 90, 0);
    let agendado: ReturnType<typeof setInterval> | null = null;

    const passar = async (): Promise<void> => {
        const limite = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
        try {
            const alterados = await motor.anonimizarDiarioAte(limite);
            if (alterados > 0) {
                registrador.info("diario_anonimizado", { eventos: alterados, antesDe: limite.toISOString() });
            }
        } catch (erro) {
            // Expurgo que derruba o serviço troca um risco por outro pior.
            registrador.erro("anonimizacao_falhou", { ...descreverErro(erro) });
        }
    };

    return {
        iniciar: () => {
            if (dias === 0) {
                registrador.aviso("retencao_sem_limite", {
                    detalhe: "SALAO_RETENCAO_DIAS=0: nome e telefone ficam no diário indefinidamente."
                });
                return;
            }
            void passar();
            agendado = setInterval(() => void passar(), 24 * 60 * 60 * 1000);
            agendado.unref();
        },
        parar: () => {
            if (agendado !== null) {
                clearInterval(agendado);
                agendado = null;
            }
        }
    };
}

function iniciar(): void {
    const porta = lerPorta();
    const autenticador = lerAutenticacao(registrador);
    const armazenamento = montarArmazenamento();
    const notificador = montarNotificador();

    const motor = new MotorGerente(armazenamento.repositorio, { notificador, registrador });
    const estadoDoBackup = (): EstadoDoBackup | null => armazenamento.backup?.estado() ?? null;
    const pulso = montarPulso(estadoDoBackup);
    const expurgo = montarExpurgo(motor);

    const servidor = criarServidor(motor, {
        autenticador,
        registrador,
        backup: estadoDoBackup,
        pulso: () => pulso?.estado() ?? null
    });

    servidor.listen(porta, () => {
        const endereco = servidor.address();
        registrador.info("servico_iniciado", {
            porta: typeof endereco === "object" && endereco !== null ? endereco.port : porta,
            armazenamento: armazenamento.descricao
        });

        // Depois de a porta abrir: a primeira cópia não pode atrasar o salão
        // a subir, e se a pasta estiver ruim o serviço atende mesmo assim.
        armazenamento.backup?.iniciar();

        // O primeiro pulso fecha o alerta que a queda anterior abriu.
        pulso?.iniciar();
        expurgo.iniciar();
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
        pulso?.parar();
        expurgo.parar();

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
