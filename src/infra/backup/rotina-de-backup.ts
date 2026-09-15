import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Relogio, relogioDoSistema } from "../../compartilhado/tempo/relogio.js";
import {
    descreverErro,
    registradorSilencioso,
    type Registrador
} from "../../compartilhado/log/registrador.js";

/**
 * Cópias periódicas do banco.
 *
 * O estado do salão é o registro operacional do estabelecimento num arquivo só,
 * num computador de balcão. Sem cópia, um disco ruim ou um apagão no meio de
 * uma escrita levam junto a noite inteira e todo o histórico — e é para esse
 * risco, e não para outro, que esta rotina serve.
 *
 * Uma cópia no mesmo disco não protege contra o disco morrer. Ela protege
 * contra corrupção, contra apagar sem querer e contra erro de operação, que é a
 * maioria dos casos. Para o resto, aponte um OneDrive, um Google Drive ou um
 * pendrive para a pasta das cópias: são arquivos comuns, e qualquer sincronismo
 * serve.
 *
 * Quem copia entra por parâmetro, e não é o repositório: assim a rotina se
 * testa sem banco e não sabe que existe SQLite.
 */

export interface OpcoesDaRotina {
    /** Onde as cópias ficam. Criada se não existir. */
    pasta: string;
    /** De quantas em quantas horas copiar. */
    aCadaHoras: number;
    /** Quantas cópias guardar; as mais antigas são apagadas. */
    copias: number;
    /**
     * Uma segunda pasta que recebe cópia de cada cópia. É o que tira o backup
     * do disco que pode morrer.
     *
     * Aponte para a pasta local de um OneDrive, de um Google Drive ou para um
     * pendrive: são arquivos comuns, e quem sincroniza é o programa que já está
     * na máquina. Não há SDK de nuvem aqui, nem precisa haver.
     *
     * Falhar aqui não derruba a cópia local — pendrive tirado da porta não pode
     * deixar o restaurante sem backup nenhum —, mas aparece em `estado()`.
     */
    espelho?: string | undefined;
    registrador?: Registrador | undefined;
    relogio?: Relogio | undefined;
}

/**
 * Como foi a última tentativa de cópia.
 *
 * Existe para ser mostrado, não só registrado. Backup que falha em silêncio é
 * o desastre clássico: a casa descobre que não tinha cópia no dia em que
 * precisa dela. Por isso isto sai em `/saude`, onde dá para olhar.
 */
export interface EstadoDoBackup {
    /** `null` enquanto nenhuma tentativa aconteceu. */
    ultimaCopiaEm: string | null;
    ultimoArquivo: string | null;
    /** Mensagem da última falha, ou `null` se a última tentativa deu certo. */
    ultimaFalha: string | null;
    /** Quantas falharam seguidas. Zera a cada sucesso. */
    falhasSeguidas: number;
    /** `null` quando não há espelho configurado. */
    espelho: { ultimaCopiaEm: string | null; ultimaFalha: string | null } | null;
}

const PREFIXO = "salao-";
const SUFIXO = ".db";

/**
 * Nome do arquivo a partir do instante, em UTC e sem `:` — Windows não aceita
 * dois-pontos em nome de arquivo, e um nome que não serve nos dois sistemas
 * quebra na hora de mover as cópias para outro lugar.
 */
export function nomeDaCopia(instante: Date): string {
    return `${PREFIXO}${instante.toISOString().replace(/[:.]/gu, "-")}${SUFIXO}`;
}

/** As cópias que já existem, da mais antiga para a mais nova. */
function copiasExistentes(pasta: string): string[] {
    return (
        readdirSync(pasta)
            .filter((nome) => nome.startsWith(PREFIXO) && nome.endsWith(SUFIXO))
            // O nome carrega a data em ISO, que ordena igual em texto e em tempo.
            .sort()
    );
}

export class RotinaDeBackup {
    readonly #copiar: (destino: string) => void;
    readonly #opcoes: OpcoesDaRotina;
    readonly #registrador: Registrador;
    readonly #relogio: Relogio;
    #agendado: ReturnType<typeof setInterval> | null = null;

    #ultimaCopiaEm: string | null = null;
    #ultimoArquivo: string | null = null;
    #ultimaFalha: string | null = null;
    #falhasSeguidas = 0;
    #espelhoEm: string | null = null;
    #espelhoFalha: string | null = null;

    constructor(copiar: (destino: string) => void, opcoes: OpcoesDaRotina) {
        this.#copiar = copiar;
        this.#opcoes = opcoes;
        this.#registrador = opcoes.registrador ?? registradorSilencioso;
        this.#relogio = opcoes.relogio ?? relogioDoSistema;
    }

    /** Como foi a última tentativa. Para `/saude` mostrar, e não só o log. */
    estado(): EstadoDoBackup {
        return {
            ultimaCopiaEm: this.#ultimaCopiaEm,
            ultimoArquivo: this.#ultimoArquivo,
            ultimaFalha: this.#ultimaFalha,
            falhasSeguidas: this.#falhasSeguidas,
            espelho:
                this.#opcoes.espelho === undefined
                    ? null
                    : { ultimaCopiaEm: this.#espelhoEm, ultimaFalha: this.#espelhoFalha }
        };
    }

    /**
     * Copia agora e agenda as próximas. A primeira sai na subida de propósito:
     * é a que garante que existe pelo menos uma cópia boa antes do expediente,
     * e é também o teste de que a pasta é gravável — melhor descobrir que não é
     * ao ligar do que seis horas depois.
     */
    iniciar(): void {
        this.agora();

        const intervalo = this.#opcoes.aCadaHoras * 60 * 60 * 1000;
        this.#agendado = setInterval(() => this.agora(), intervalo);
        // Não segura o processo de pé só por causa do backup.
        this.#agendado.unref();
    }

    parar(): void {
        if (this.#agendado !== null) {
            clearInterval(this.#agendado);
            this.#agendado = null;
        }
    }

    /**
     * Uma cópia, agora. Nunca lança: backup que derruba o serviço troca um
     * risco por outro pior — o salão tem de continuar atendendo mesmo que a
     * pasta das cópias tenha sumido.
     */
    agora(): string | null {
        const instante = this.#relogio.agora();
        try {
            mkdirSync(this.#opcoes.pasta, { recursive: true });

            const nome = nomeDaCopia(instante);
            const destino = join(this.#opcoes.pasta, nome);
            this.#copiar(destino);
            this.#registrador.info("backup_gravado", { arquivo: destino });

            this.#ultimaCopiaEm = instante.toISOString();
            this.#ultimoArquivo = destino;
            this.#ultimaFalha = null;
            this.#falhasSeguidas = 0;

            this.#limpar(this.#opcoes.pasta);
            this.#espelhar(destino, nome, instante);
            return destino;
        } catch (erro) {
            const descricao = descreverErro(erro);
            this.#ultimaFalha = String(descricao.mensagem ?? erro);
            this.#falhasSeguidas += 1;

            this.#registrador.erro("backup_falhou", {
                pasta: this.#opcoes.pasta,
                falhasSeguidas: this.#falhasSeguidas,
                ...descricao
            });
            return null;
        }
    }

    /**
     * Copia a cópia para a segunda pasta — a que tira o backup deste disco.
     *
     * Erro aqui não derruba a cópia local: pendrive fora da porta, OneDrive
     * desconectado ou rede caída não podem deixar o restaurante sem backup
     * nenhum. Fica registrado como aviso e aparece em `estado()`, que é onde
     * alguém tem chance de notar.
     */
    #espelhar(origem: string, nome: string, instante: Date): void {
        const espelho = this.#opcoes.espelho;
        if (espelho === undefined) {
            return;
        }

        try {
            // A pasta de destino é criada; a de cima, não.
            //
            // Com `recursive`, um caminho digitado errado — ou escrito no
            // formato de outro sistema, como `/c/Users/...` — faz o Windows
            // resolvê-lo a partir da raiz do disco e criar a árvore inteira ali.
            // A cópia "dá certo", e o dono segue achando que tem backup no
            // OneDrive enquanto ele vai para um canto que ninguém sincroniza.
            // Exigir que a pasta de cima já exista transforma isso num erro
            // visível, que é o desejável num caminho errado.
            const acima = dirname(espelho);
            if (!existsSync(acima)) {
                throw new Error(
                    `A pasta ${acima} não existe. SALAO_BACKUP_ESPELHO deve apontar para dentro de ` +
                        "uma pasta que já existe — a do OneDrive, do Drive ou do pendrive."
                );
            }

            // Sem `recursive`, criar o que já existe lançaria — e a partir da
            // segunda cópia ela sempre existe.
            if (!existsSync(espelho)) {
                mkdirSync(espelho);
            }
            copyFileSync(origem, join(espelho, nome));

            this.#espelhoEm = instante.toISOString();
            this.#espelhoFalha = null;
            this.#registrador.info("backup_espelhado", { pasta: espelho });

            this.#limpar(espelho);
        } catch (erro) {
            const descricao = descreverErro(erro);
            this.#espelhoFalha = String(descricao.mensagem ?? erro);
            this.#registrador.aviso("backup_espelho_falhou", {
                pasta: espelho,
                ...descricao
            });
        }
    }

    /** Apaga as cópias que passam do limite, da mais antiga para a mais nova. */
    #limpar(pasta: string): void {
        const existentes = copiasExistentes(pasta);
        const sobrando = existentes.length - this.#opcoes.copias;
        if (sobrando <= 0) {
            return;
        }

        for (const nome of existentes.slice(0, sobrando)) {
            const caminho = join(pasta, nome);
            try {
                rmSync(caminho);
                this.#registrador.info("backup_antigo_removido", { arquivo: caminho });
            } catch (erro) {
                // Não conseguir apagar uma cópia velha é sujeira, não perda.
                this.#registrador.aviso("backup_antigo_nao_removido", {
                    arquivo: caminho,
                    ...descreverErro(erro)
                });
            }
        }
    }
}
