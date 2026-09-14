/**
 * O que aconteceu no salão, em ordem. É o diário da operação: o estado diz
 * como o salão está agora, o diário diz como ele chegou aqui — e é só dele que
 * sai qualquer pergunta sobre o passado, como quanto foi a maior espera da
 * noite ou quantas vezes cada mesa girou.
 *
 * Os nomes são neutros de propósito. `reserva_cancelada` é o fato; chamar isso
 * de "não apareceu" é leitura de quem apresenta, e nem sempre é verdade — o
 * anfitrião pode cancelar por outro motivo.
 */
export type TipoDeEvento =
    | "mesa_cadastrada"
    | "mesa_removida"
    | "sentou_direto"
    | "entrou_na_fila"
    | "saiu_da_fila"
    | "chamado"
    | "ocupou"
    | "liberou"
    | "reserva_cancelada";

/**
 * Um registro chapado, com os campos que não se aplicam em `null`.
 *
 * Podia ser uma união discriminada, mais bonita em TypeScript. Seria uma linha
 * de tabela por variante para persistir, e o diário é justamente a parte do
 * sistema que mais quer ser uma tabela só, consultável por período.
 *
 * Cada evento carrega o que precisa para ser lido sozinho — inclusive a
 * capacidade da mesa. Uma mesa apagada amanhã não pode apagar o relatório de
 * ontem.
 */
export interface EventoDoSalao {
    /** ISO 8601. */
    momento: string;
    tipo: TipoDeEvento;
    mesaId: string | null;
    mesaNumero: number | null;
    capacidade: number | null;
    telefone: string | null;
    nome: string | null;
    pessoas: number | null;
    /** Quanto esperou na fila. Só em `chamado`. */
    esperaEmSegundos: number | null;
    /** Quanto o grupo ficou com a mesa. Só em `liberou` e `reserva_cancelada`. */
    permanenciaEmSegundos: number | null;
}

/** Intervalo fechado no início e aberto no fim: `[inicio, fim)`. */
export interface Periodo {
    inicio: Date;
    fim: Date;
}
