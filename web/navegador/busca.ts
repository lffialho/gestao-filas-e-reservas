/**
 * Casamento da busca do painel.
 *
 * Telefone é comparado só pelos dígitos: quem digita "11999" no balcão está
 * procurando "+5511999999999", e exigir o formato exato seria exigir que o
 * atendente lembrasse como o número foi cadastrado.
 */

const soDigitos = (texto: string): string => texto.replace(/\D/gu, "");

export function normalizarTermo(bruto: string): string {
    return bruto.trim().toLowerCase();
}

/** Termo vazio casa com tudo — é o estado normal do painel, sem filtro. */
export function casa(termo: string, nome: string | null, telefone: string | null): boolean {
    if (termo === "") {
        return true;
    }
    if (nome?.toLowerCase().includes(termo) === true) {
        return true;
    }

    const digitos = soDigitos(termo);
    return digitos !== "" && telefone !== null && soDigitos(telefone).includes(digitos);
}
