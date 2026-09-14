import type { Salao } from "../entidades/salao.js";
import type { EventoDoSalao, Periodo } from "../eventos.js";

/**
 * Porta de saída do domínio: onde o salão é guardado.
 *
 * `transacao` é a unidade de atomicidade. O repositório carrega o salão,
 * entrega à operação, e persiste o resultado — tudo ou nada. Se a operação
 * lançar, nada é gravado.
 *
 * A operação é **síncrona** de propósito: isso impede que E/S entre no meio de
 * uma decisão de alocação, que é justamente onde mesas e fila precisam mudar
 * juntas. Quem faz E/S é o repositório, antes e depois.
 *
 * Implementações:
 * - em memória, a transação é uma trava que serializa as operações;
 * - num banco, é uma transação de verdade. Serializar por processo, como faz a
 *   versão em memória, deixa de bastar quando há mais de um processo.
 *
 * O salão inteiro é um agregado pequeno — dezenas de mesas, dezenas de pessoas
 * na fila — então carregá-lo por transação é aceitável. Se um dia deixar de
 * ser, o contrato permite que a implementação leia e escreva por linha.
 *
 * `consulta` é o mesmo contrato sem escrita: enxerga um salão coerente e
 * promete não gravar nada. A separação não é cosmética — quando toda leitura
 * passava por `transacao`, um `GET` tomava a trava de escrita do banco e
 * reescrevia o salão inteiro, de modo que dois processos não conseguiam nem
 * ler ao mesmo tempo. O que a operação devolve tem de ser retrato, não
 * entidade viva: o salão emprestado deixa de valer quando a chamada termina.
 */
export interface RepositorioDoSalao {
    transacao<T>(operacao: (salao: Salao) => T): Promise<T>;
    consulta<T>(leitura: (salao: Salao) => T): Promise<T>;

    /**
     * O diário do período, em ordem. Quem grava é `transacao`, na mesma
     * transação do estado: evento escrito depois sobreviveria a um rollback e
     * o relatório passaria a contar atendimento que não houve.
     *
     * Só leitura, e por isso fora de `consulta`: o diário não é o agregado, é
     * o que já aconteceu com ele.
     */
    eventos(periodo: Periodo): Promise<EventoDoSalao[]>;
}
