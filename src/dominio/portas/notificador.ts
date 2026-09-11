export interface AvisoDeMesaPronta {
    nome: string;
    telefone: string;
    mesaId: string;
    mesaNumero: number;
}

/**
 * Porta de saída para avisar quem estava na fila que a mesa ficou pronta.
 * Sem isto o telefone é coletado e nunca usado — e para uma fila de espera
 * avisar é metade do serviço.
 *
 * Duas regras de quem chama:
 *
 * - avise **depois** da transação confirmar. Avisar dentro dela mandaria
 *   mensagem sobre uma mesa que o rollback ainda pode desfazer;
 * - falha de aviso **não** desfaz a alocação. A mesa já é daquele cliente;
 *   o certo é registrar a falha e seguir, não cancelar o atendimento porque
 *   o provedor de SMS caiu.
 */
export interface Notificador {
    mesaPronta(aviso: AvisoDeMesaPronta): Promise<void>;
}
