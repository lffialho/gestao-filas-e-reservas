/**
 * Tira do log o que identifica uma pessoa.
 *
 * O log é o que se manda para quem dá suporte — e, num software vendido a
 * estabelecimentos, quem dá suporte é um terceiro em relação a quem jantou ali.
 * Mascarar na hora de escrever, e não na hora de empacotar, é o que faz o
 * arquivo em disco já nascer inofensivo: um log vazado não vira lista de
 * telefones, e o pacote de suporte não precisa confiar em ninguém limpá-lo.
 *
 * Fica o suficiente para investigar: os quatro últimos dígitos bastam para
 * casar uma linha de log com o cliente que reclamou, sem carregar o número.
 */

/** Oito dígitos ou mais, com ou sem `+` — o que parece telefone em qualquer formato. */
const PARECE_TELEFONE = /\+?\d[\d\s().-]{7,}\d/gu;

/**
 * `+5511999990001` vira `••••0001`. Curto demais para identificar, longo o
 * bastante para conferir contra o que o cliente informou.
 */
export function mascararTelefone(telefone: string): string {
    const digitos = telefone.replace(/\D/gu, "");
    if (digitos.length <= 4) {
        // Curto assim não identifica ninguém, e mascarar tiraria o pouco que
        // ajuda a investigar.
        return digitos;
    }
    return `••••${digitos.slice(-4)}`;
}

/**
 * Mascara o que parece telefone dentro de um caminho de URL.
 *
 * `DELETE /fila/+5511999990001` ia inteiro para o log. Mascarar o caminho, em
 * vez de listar as rotas que têm telefone, cobre também a rota que alguém
 * acrescentar amanhã sem lembrar disto.
 */
export function mascararCaminho(caminho: string): string {
    return caminho.replace(PARECE_TELEFONE, (achado) => mascararTelefone(achado));
}

/**
 * Um nome não tem formato que dê para reconhecer, então some inteiro; fica só
 * o tamanho, que às vezes explica um erro de validação.
 */
export function mascararNome(nome: string): string {
    return `«nome de ${nome.trim().length} caracteres»`;
}
