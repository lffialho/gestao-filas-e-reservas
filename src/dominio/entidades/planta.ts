/**
 * A planta do salão: uma grade de ladrilhos onde as mesas ficam.
 *
 * Posição é informação do estabelecimento, não da tela — um salão real tem
 * disposição de mesas, e quem opera precisa reconhecer "a mesa do canto". Por
 * isso mora no domínio e é persistida junto com o resto.
 *
 * Nenhuma regra de alocação usa posição: quem senta onde continua sendo decidido
 * por capacidade e ordem de chegada. A planta serve para operar e enxergar.
 */
export const COLUNAS_DA_PLANTA = 12;
export const LINHAS_DA_PLANTA = 9;

export interface Posicao {
    coluna: number;
    linha: number;
}

export function dentroDaPlanta(posicao: Posicao): boolean {
    return (
        Number.isInteger(posicao.coluna) &&
        Number.isInteger(posicao.linha) &&
        posicao.coluna >= 0 &&
        posicao.linha >= 0 &&
        posicao.coluna < COLUNAS_DA_PLANTA &&
        posicao.linha < LINHAS_DA_PLANTA
    );
}

export function mesmaPosicao(a: Posicao, b: Posicao): boolean {
    return a.coluna === b.coluna && a.linha === b.linha;
}
