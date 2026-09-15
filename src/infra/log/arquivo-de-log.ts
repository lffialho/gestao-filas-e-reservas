import { appendFileSync, existsSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import type { Nivel } from "../../compartilhado/log/registrador.js";

/**
 * Guarda o log num arquivo, com rodízio.
 *
 * Rodando como tarefa do Agendador, **o log se perde inteiro**: ninguém vê o
 * stdout de um processo que sobe sozinho ao ligar o computador. Quando a casa
 * liga dizendo que algo deu errado às nove da noite de sábado, não há o que
 * olhar — e é justamente essa a hora em que se precisa olhar.
 *
 * O rodízio existe porque log sem limite enche o disco do balcão, e disco cheio
 * derruba o salão junto. Quatro arquivos de 5 MB cobrem semanas de operação de
 * um restaurante e ocupam menos que uma foto.
 *
 * Escrita síncrona de propósito: o volume aqui é de poucas linhas por segundo —
 * um painel consultando a cada três segundos —, e escrita assíncrona traria
 * ordenação fora de ordem e linhas perdidas ao encerrar, que é exatamente
 * quando o log importa mais.
 *
 * **Nunca lança.** Log que derruba o serviço troca um problema pequeno por um
 * grande: o salão tem de continuar atendendo mesmo que o disco tenha enchido.
 */

export interface OpcoesDoArquivoDeLog {
    caminho: string;
    /** Padrão: 5 MB. Ao passar disso, o arquivo roda. */
    tamanhoMaximoEmBytes?: number | undefined;
    /** Quantos arquivos antigos guardar, além do atual. Padrão: 3. */
    copias?: number | undefined;
}

export class PastaDeLogInexistente extends Error {}

function tamanhoAtual(caminho: string): number {
    try {
        return statSync(caminho).size;
    } catch {
        // Ainda não existe: começa do zero.
        return 0;
    }
}

/**
 * `salao.log` vira `salao.log.1`, o `.1` vira `.2`, e o mais velho sai.
 * Numerar do mais novo para o mais velho é o que deixa `.1` ser sempre "o
 * anterior", sem precisar olhar data.
 */
function rodar(caminho: string, copias: number): void {
    const maisVelho = `${caminho}.${copias}`;
    if (existsSync(maisVelho)) {
        rmSync(maisVelho, { force: true });
    }

    for (let i = copias - 1; i >= 1; i -= 1) {
        const de = `${caminho}.${i}`;
        if (existsSync(de)) {
            renameSync(de, `${caminho}.${i + 1}`);
        }
    }

    if (existsSync(caminho)) {
        renameSync(caminho, `${caminho}.1`);
    }
}

/**
 * Devolve um escritor para entregar a `criarRegistradorJson`.
 *
 * A pasta precisa existir — criar a árvore inteira a partir de um caminho
 * digitado errado faria o log nascer num canto que ninguém procura, e é engano
 * que já aconteceu aqui com a pasta do espelho do backup.
 */
export function criarEscritorDeArquivo(opcoes: OpcoesDoArquivoDeLog): (linha: string, nivel: Nivel) => void {
    const pasta = dirname(opcoes.caminho);
    if (!existsSync(pasta)) {
        throw new PastaDeLogInexistente(
            `A pasta ${pasta} não existe. SALAO_LOG_ARQUIVO deve apontar para dentro de uma pasta que já existe.`
        );
    }

    const maximo = opcoes.tamanhoMaximoEmBytes ?? 5 * 1024 * 1024;
    const copias = opcoes.copias ?? 3;
    let acumulado = tamanhoAtual(opcoes.caminho);

    return (linha: string): void => {
        const texto = `${linha}\n`;
        try {
            if (acumulado + texto.length > maximo && acumulado > 0) {
                rodar(opcoes.caminho, copias);
                acumulado = 0;
            }

            appendFileSync(opcoes.caminho, texto, "utf8");
            acumulado += Buffer.byteLength(texto);
        } catch {
            // Disco cheio, permissão negada, arquivo travado por outro
            // processo: nada disso pode interromper o atendimento. O stdout
            // continua recebendo a mesma linha.
        }
    };
}
