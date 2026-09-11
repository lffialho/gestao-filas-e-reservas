import type { Salao } from "../entidades/salao.js";

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
 */
export interface RepositorioDoSalao {
    transacao<T>(operacao: (salao: Salao) => T): Promise<T>;
}
