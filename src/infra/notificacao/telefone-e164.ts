import { DadosInvalidos } from "../../dominio/erros.js";

/**
 * Converte o telefone como o salão o guarda para E.164, que é o que provedor
 * de mensagem exige.
 *
 * O domínio aceita telefone como texto livre — é identidade de cliente, não
 * endereço de entrega, e o anfitrião digita "11 98765-4321". Normalizar é
 * responsabilidade de quem vai entregar a mensagem, e é aqui.
 *
 * @param paisPadrao DDI usado quando o número vem sem ele (55 para Brasil).
 */
export function paraE164(telefone: string, paisPadrao: string): string {
    const jaTemDdi = telefone.trim().startsWith("+");
    const digitos = telefone.replace(/\D/g, "");

    if (digitos === "") {
        throw new DadosInvalidos(`Telefone sem dígitos: "${telefone}".`);
    }

    const completo = jaTemDdi || digitos.startsWith(paisPadrao) ? digitos : `${paisPadrao}${digitos}`;

    // E.164: no máximo 15 dígitos, e nenhum país tem menos de 8 no total.
    if (completo.length < 8 || completo.length > 15) {
        throw new DadosInvalidos(
            `Telefone "${telefone}" não forma um número E.164 válido (${completo.length} dígitos).`
        );
    }

    return `+${completo}`;
}
