import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/**
 * Autenticação por token compartilhado da equipe. A API é de retaguarda —
 * quem opera é o salão, não o cliente final — então um token por instalação
 * resolve, sem usuários nem sessão.
 *
 * Não é o bastante para uma API pública multiusuário; para isso o token dá
 * lugar a credencial por pessoa, e este módulo é onde a troca acontece.
 */
export interface Autenticador {
    /** Verdadeiro se a requisição pode seguir. */
    permite(requisicao: IncomingMessage): boolean;
}

/** Comparação em tempo constante: `===` vazaria o prefixo correto pelo tempo. */
function iguaisEmTempoConstante(a: string, b: string): boolean {
    const bytesA = Buffer.from(a, "utf8");
    const bytesB = Buffer.from(b, "utf8");

    // timingSafeEqual exige mesmo tamanho; o próprio tamanho não é segredo útil.
    if (bytesA.length !== bytesB.length) {
        return false;
    }
    return timingSafeEqual(bytesA, bytesB);
}

function tokenDaRequisicao(requisicao: IncomingMessage): string | null {
    const autorizacao = requisicao.headers.authorization;
    if (typeof autorizacao === "string" && autorizacao.startsWith("Bearer ")) {
        return autorizacao.slice("Bearer ".length).trim();
    }

    const cabecalho = requisicao.headers["x-api-key"];
    if (typeof cabecalho === "string" && cabecalho.trim() !== "") {
        return cabecalho.trim();
    }
    return null;
}

export function autenticadorPorToken(tokenEsperado: string): Autenticador {
    if (tokenEsperado.trim() === "") {
        throw new Error("O token de autenticação não pode ser vazio.");
    }
    return {
        permite: (requisicao) => {
            const recebido = tokenDaRequisicao(requisicao);
            return recebido !== null && iguaisEmTempoConstante(recebido, tokenEsperado);
        }
    };
}

/** Deixa tudo passar. Só para desenvolvimento e teste. */
export const autenticadorAberto: Autenticador = {
    permite: () => true
};
