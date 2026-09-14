import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Sessão do painel.
 *
 * O painel guarda o `SALAO_TOKEN` e o injeta nas chamadas, então **quem alcança
 * o painel manda no salão** sem precisar de token nenhum. Como ele escuta na
 * rede — é essa a razão de existir, o tablet do balcão —, sem senha qualquer um
 * no wifi do restaurante senta gente, libera mesa e fecha o dia.
 *
 * Daí uma senha própria do painel, separada do token da API. São segredos de
 * papéis diferentes: o token é o que o painel usa para falar com o serviço; a
 * senha é o que uma pessoa usa para falar com o painel.
 *
 * A chave que assina a sessão **sai da própria senha**, e não de um segredo
 * sorteado ao subir. Dois motivos: não há mais uma variável para configurar em
 * cada casa, e a sessão sobrevive ao processo reiniciar — o que importa aqui,
 * porque o Agendador levanta o painel de novo a cada pane, e ninguém quer ser
 * deslogado no meio do serviço de sábado. Trocar a senha invalida as sessões
 * abertas, que é exatamente o que se espera ao trocar uma senha.
 */

export const NOME_DO_COOKIE = "painel_sessao";

/** Um turno. Longo o bastante para o serviço inteiro sem pedir senha de novo. */
export const DURACAO_EM_HORAS = 12;

/**
 * A chave de assinatura, derivada da senha. O prefixo separa este uso de
 * qualquer outro que a senha venha a ter: a mesma senha em contextos diferentes
 * não pode gerar a mesma chave.
 */
function chaveDe(senha: string): Buffer {
    return createHmac("sha256", "painel-sessao-v1").update(senha, "utf8").digest();
}

function assinar(dados: string, senha: string): string {
    return createHmac("sha256", chaveDe(senha)).update(dados, "utf8").digest("base64url");
}

/** Comparação em tempo constante: `===` vazaria o prefixo correto pelo tempo. */
export function iguaisEmTempoConstante(a: string, b: string): boolean {
    const bytesA = Buffer.from(a, "utf8");
    const bytesB = Buffer.from(b, "utf8");

    // timingSafeEqual exige mesmo tamanho; o próprio tamanho não é segredo útil.
    if (bytesA.length !== bytesB.length) {
        return false;
    }
    return timingSafeEqual(bytesA, bytesB);
}

/**
 * O valor do cookie: quando expira, e a assinatura disso. Não carrega nada mais
 * — não há o que guardar sobre quem entrou, porque só existe uma senha e uma
 * equipe. O que o cookie prova é "alguém sabia a senha até tal hora".
 */
export function criarSessao(senha: string, agora: Date = new Date()): string {
    const expiraEm = agora.getTime() + DURACAO_EM_HORAS * 60 * 60 * 1000;
    const dados = String(expiraEm);
    return `${dados}.${assinar(dados, senha)}`;
}

export function sessaoValida(valor: string | null, senha: string, agora: Date = new Date()): boolean {
    if (valor === null) {
        return false;
    }

    // Um ponto só: a assinatura em base64url não tem pontos, então o primeiro
    // separa os dois campos sem ambiguidade.
    const separador = valor.indexOf(".");
    if (separador <= 0) {
        return false;
    }

    const dados = valor.slice(0, separador);
    const assinatura = valor.slice(separador + 1);

    // A assinatura é conferida antes do prazo, de propósito: um valor que não
    // assinamos não merece ter seu conteúdo interpretado.
    if (!iguaisEmTempoConstante(assinatura, assinar(dados, senha))) {
        return false;
    }

    const expiraEm = Number(dados);
    return Number.isFinite(expiraEm) && agora.getTime() < expiraEm;
}

/**
 * Lê um cookie do cabeçalho. Feito à mão porque é só isto que precisamos, e
 * uma dependência para partir string em `;` não se justifica.
 */
export function lerCookie(cabecalho: string | undefined, nome: string): string | null {
    if (cabecalho === undefined) {
        return null;
    }

    for (const pedaco of cabecalho.split(";")) {
        const igual = pedaco.indexOf("=");
        if (igual <= 0) {
            continue;
        }
        if (pedaco.slice(0, igual).trim() === nome) {
            return decodeURIComponent(pedaco.slice(igual + 1).trim());
        }
    }
    return null;
}

/**
 * O cookie que autentica.
 *
 * `HttpOnly` porque nenhum script do painel tem o que fazer com ele, e isso o
 * põe fora do alcance de um XSS. `SameSite=Strict` porque toda ação do painel é
 * uma escrita no salão: sem isso, um link aberto no mesmo tablet conseguiria
 * liberar mesas em nome de quem está logado.
 *
 * Sem `Secure`: o painel roda em `http://` na rede local, e um cookie `Secure`
 * simplesmente não seria mandado. É uma escolha consciente, e o que ela custa
 * está escrito no README.
 */
export function cabecalhoDoCookie(valor: string, duracaoEmSegundos: number): string {
    return [
        `${NOME_DO_COOKIE}=${encodeURIComponent(valor)}`,
        "Path=/",
        "HttpOnly",
        "SameSite=Strict",
        `Max-Age=${duracaoEmSegundos}`
    ].join("; ");
}

export function cabecalhoParaSair(): string {
    return `${NOME_DO_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
