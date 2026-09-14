import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * A senha do painel, criada por quem opera na primeira abertura.
 *
 * Antes ela vinha de `PAINEL_SENHA`, no `.env`. Trocar por isto muda quem
 * decide: instalar deixa de exigir que alguém abra um arquivo de configuração e
 * invente uma senha ali, e o sistema pede a senha na cara, uma vez, a quem vai
 * usá-lo. Uma instalação a menos para dar errado em silêncio.
 *
 * **Guardamos o hash, nunca a senha.** Quem abrir o arquivo — um backup
 * sincronizado para a nuvem, por exemplo — não fica sabendo a senha, e como
 * quase todo mundo repete senha entre sistemas, isso importa além daqui.
 *
 * `scrypt` porque vem no Node e é feito para senha: é caro de propósito, então
 * quem levar o arquivo não testa milhões de palpites por segundo. SHA-256 puro
 * seria rápido demais para isso, e é o engano comum.
 *
 * Perder o arquivo não tranca ninguém para fora: sem ele o painel volta a pedir
 * uma senha nova, como na primeira vez. Não é fraqueza — quem alcança o disco
 * já alcança o banco do restaurante inteiro; é a saída de quem esqueceu a senha.
 */

/** Cara o bastante para punir tentativa em massa, rápido o bastante no balcão. */
const CUSTO = { N: 16384, r: 8, p: 1 } as const;
const TAMANHO_DO_HASH = 64;
const TAMANHO_DO_SAL = 16;

/** Curta demais não protege nada, e a porta do painel fica exposta na rede. */
export const MINIMO_DE_CARACTERES = 8;

export interface Credencial {
    /** Para poder trocar o algoritmo um dia sem trancar quem já tem senha. */
    readonly versao: 1;
    readonly sal: string;
    readonly hash: string;
    readonly criadaEm: string;
}

export class SenhaInvalida extends Error {}

export function criarCredencial(senha: string, agora: Date = new Date()): Credencial {
    if (senha.length < MINIMO_DE_CARACTERES) {
        throw new SenhaInvalida(`A senha precisa de pelo menos ${MINIMO_DE_CARACTERES} caracteres.`);
    }

    const sal = randomBytes(TAMANHO_DO_SAL);
    return {
        versao: 1,
        sal: sal.toString("base64"),
        hash: scryptSync(senha, sal, TAMANHO_DO_HASH, CUSTO).toString("base64"),
        criadaEm: agora.toISOString()
    };
}

export function senhaConfere(senha: string, credencial: Credencial): boolean {
    const esperado = Buffer.from(credencial.hash, "base64");
    const obtido = scryptSync(senha, Buffer.from(credencial.sal, "base64"), esperado.length, CUSTO);

    // Tamanho igual por construção; timingSafeEqual exige isso e não compara
    // byte a byte de forma que o tempo conte qual prefixo estava certo.
    return esperado.length === obtido.length && timingSafeEqual(esperado, obtido);
}

/**
 * A chave que assina as sessões, derivada do hash da senha.
 *
 * Sai do hash, e não da senha, porque o servidor não guarda a senha — só a vê
 * no instante em que alguém a digita. E sai dele de propósito: **trocar a senha
 * troca o hash, que troca a chave, que invalida toda sessão aberta**, que é o
 * que se espera ao trocar uma senha. Também sobrevive ao processo reiniciar,
 * sem mais um segredo para configurar.
 */
export function chaveDeSessao(credencial: Credencial): Buffer {
    return createHmac("sha256", "painel-sessao-v1").update(credencial.hash, "utf8").digest();
}

function pareceCredencial(valor: unknown): valor is Credencial {
    if (typeof valor !== "object" || valor === null) {
        return false;
    }
    const c = valor as Record<string, unknown>;
    return (
        c["versao"] === 1 &&
        typeof c["sal"] === "string" &&
        typeof c["hash"] === "string" &&
        typeof c["criadaEm"] === "string"
    );
}

/**
 * Lê a credencial do disco. `null` quando ainda não há senha — que é o sinal de
 * primeira abertura.
 *
 * Arquivo corrompido ou de formato desconhecido também vira `null`, e não erro:
 * o painel que não sobe é pior do que o painel que pede uma senha nova. Quem
 * puder trocar esse arquivo já podia apagá-lo.
 */
export function lerCredencial(caminho: string): Credencial | null {
    let conteudo: string;
    try {
        conteudo = readFileSync(caminho, "utf8");
    } catch {
        return null;
    }

    try {
        const lido: unknown = JSON.parse(conteudo);
        return pareceCredencial(lido) ? lido : null;
    } catch {
        return null;
    }
}

export function gravarCredencial(caminho: string, credencial: Credencial): void {
    // 0o600 é o que importa em Linux e macOS; no Windows o que protege é a ACL
    // da pasta do usuário, e passar o modo aqui não atrapalha.
    writeFileSync(caminho, `${JSON.stringify(credencial, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}
