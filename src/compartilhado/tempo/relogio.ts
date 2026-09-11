/**
 * Fonte de tempo do domínio. Injetar em vez de chamar `new Date()` direto
 * deixa o tempo médio de espera testável sem precisar esperar de verdade.
 */
export interface Relogio {
    agora(): Date;
}

export const relogioDoSistema: Relogio = {
    agora: (): Date => new Date()
};
