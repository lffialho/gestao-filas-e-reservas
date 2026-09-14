import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
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
 * **Uma cópia no mesmo disco não protege contra o disco morrer.** Ela protege
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
    registrador?: Registrador | undefined;
    relogio?: Relogio | undefined;
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

    constructor(copiar: (destino: string) => void, opcoes: OpcoesDaRotina) {
        this.#copiar = copiar;
        this.#opcoes = opcoes;
        this.#registrador = opcoes.registrador ?? registradorSilencioso;
        this.#relogio = opcoes.relogio ?? relogioDoSistema;
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
        try {
            mkdirSync(this.#opcoes.pasta, { recursive: true });

            const destino = join(this.#opcoes.pasta, nomeDaCopia(this.#relogio.agora()));
            this.#copiar(destino);
            this.#registrador.info("backup_gravado", { arquivo: destino });

            this.#limpar();
            return destino;
        } catch (erro) {
            this.#registrador.erro("backup_falhou", {
                pasta: this.#opcoes.pasta,
                ...descreverErro(erro)
            });
            return null;
        }
    }

    /** Apaga as cópias que passam do limite, da mais antiga para a mais nova. */
    #limpar(): void {
        const existentes = copiasExistentes(this.#opcoes.pasta);
        const sobrando = existentes.length - this.#opcoes.copias;
        if (sobrando <= 0) {
            return;
        }

        for (const nome of existentes.slice(0, sobrando)) {
            const caminho = join(this.#opcoes.pasta, nome);
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
