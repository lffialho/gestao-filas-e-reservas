/**
 * Erros do domínio. O chamador decide o que fazer pelo tipo do erro
 * (`instanceof`), não comparando o texto da mensagem.
 */
export abstract class ErroDeDominio extends Error {
    constructor(mensagem: string) {
        super(mensagem);
        this.name = new.target.name;
    }
}

/** Argumento que não forma uma entidade válida. */
export class DadosInvalidos extends ErroDeDominio {}

export class MesaNaoEncontrada extends ErroDeDominio {
    readonly mesaId: string;

    constructor(mesaId: string) {
        super(`Mesa "${mesaId}" não encontrada.`);
        this.mesaId = mesaId;
    }
}

export class MesaDuplicada extends ErroDeDominio {
    readonly mesaId: string;

    constructor(mesaId: string) {
        super(`Já existe uma mesa cadastrada com o id "${mesaId}".`);
        this.mesaId = mesaId;
    }
}

/** Dois lugares diferentes não podem se chamar "mesa 7" para quem opera. */
export class NumeroDeMesaDuplicado extends ErroDeDominio {
    readonly numero: number;
    readonly mesaId: string;

    constructor(numero: number, mesaId: string) {
        super(`Já existe uma mesa com o número ${numero} (id "${mesaId}").`);
        this.numero = numero;
        this.mesaId = mesaId;
    }
}

export class MesaIndisponivel extends ErroDeDominio {
    readonly mesaId: string;
    readonly statusAtual: string;

    constructor(mesaId: string, statusAtual: string) {
        super(`Mesa "${mesaId}" não está disponível para reserva (status atual: ${statusAtual}).`);
        this.mesaId = mesaId;
        this.statusAtual = statusAtual;
    }
}

export class MesaJaDisponivel extends ErroDeDominio {
    readonly mesaId: string;

    constructor(mesaId: string) {
        super(`Mesa "${mesaId}" já está disponível — nada a liberar.`);
        this.mesaId = mesaId;
    }
}

/**
 * Tirar da planta uma mesa que tem gente sentada, ou que acabou de ser chamada
 * para alguém, apagaria um atendimento em curso sem ninguém decidir o que fazer
 * com quem está lá. Libere a mesa primeiro; aí a remoção é só desenho.
 */
export class MesaEmUso extends ErroDeDominio {
    readonly mesaId: string;
    readonly statusAtual: string;

    constructor(mesaId: string, statusAtual: string) {
        super(`Mesa "${mesaId}" está em uso (status atual: ${statusAtual}) — libere antes de remover.`);
        this.mesaId = mesaId;
        this.statusAtual = statusAtual;
    }
}

export class CapacidadeInsuficiente extends ErroDeDominio {
    readonly mesaId: string;
    readonly capacidade: number;
    readonly tamanhoGrupo: number;

    constructor(mesaId: string, capacidade: number, tamanhoGrupo: number) {
        super(`Mesa "${mesaId}" acomoda ${capacidade} pessoas, mas o grupo tem ${tamanhoGrupo}.`);
        this.mesaId = mesaId;
        this.capacidade = capacidade;
        this.tamanhoGrupo = tamanhoGrupo;
    }
}

/** Só faz sentido ocupar uma mesa que está reservada: o grupo chegou e sentou. */
export class TransicaoInvalida extends ErroDeDominio {
    readonly mesaId: string;
    readonly statusAtual: string;

    constructor(mesaId: string, statusAtual: string, acao: string) {
        super(`Não é possível ${acao} a mesa "${mesaId}" no status ${statusAtual}.`);
        this.mesaId = mesaId;
        this.statusAtual = statusAtual;
    }
}

export class CancelamentoInvalido extends ErroDeDominio {
    readonly mesaId: string;
    readonly statusAtual: string;

    constructor(mesaId: string, statusAtual: string) {
        super(`Mesa "${mesaId}" não tem reserva a cancelar (status atual: ${statusAtual}).`);
        this.mesaId = mesaId;
        this.statusAtual = statusAtual;
    }
}

export class ClienteJaNaFila extends ErroDeDominio {
    readonly telefone: string;

    constructor(telefone: string) {
        super(`Já existe um cliente na fila com o telefone "${telefone}".`);
        this.telefone = telefone;
    }
}

/**
 * O telefone é a identidade do cliente: é por ele que se sai da fila e é para
 * ele que o aviso de mesa pronta vai. A mesma identidade em duas mesas, ou
 * sentada e esperando ao mesmo tempo, quebra as duas coisas.
 */
export class ClienteJaNoSalao extends ErroDeDominio {
    readonly telefone: string;
    readonly mesaId: string;

    constructor(telefone: string, mesaId: string) {
        super(`O telefone "${telefone}" já está sentado na mesa "${mesaId}".`);
        this.telefone = telefone;
        this.mesaId = mesaId;
    }
}

/**
 * Reserva a dedo para quem já está na fila: o telefone casa, o resto não.
 * Sentar assim tiraria uma pessoa da fila e poria outra no lugar dela.
 */
export class IdentidadeDivergente extends ErroDeDominio {
    readonly telefone: string;
    readonly naFila: string;
    readonly recebido: string;

    constructor(telefone: string, naFila: string, recebido: string) {
        super(
            `O telefone "${telefone}" está na fila como ${naFila}, mas o pedido diz ${recebido}. ` +
                "Tire o cliente da fila antes de mudar os dados dele."
        );
        this.telefone = telefone;
        this.naFila = naFila;
        this.recebido = recebido;
    }
}

/**
 * O atendimento é por ordem de chegada: uma mesa livre não pode ir para quem
 * acabou de chegar se alguém que já esperava também caberia nela.
 */
export class FilaTemPrioridade extends ErroDeDominio {
    readonly mesaId: string;
    readonly clienteNaFila: string;

    constructor(mesaId: string, clienteNaFila: string) {
        super(
            `Mesa "${mesaId}" não pode ser entregue agora: ${clienteNaFila} está na fila desde antes e cabe nesta mesa.`
        );
        this.mesaId = mesaId;
        this.clienteNaFila = clienteNaFila;
    }
}

/** Grupo maior que a maior mesa do salão — esperar na fila não resolveria. */
export class GrupoSemMesaPossivel extends ErroDeDominio {
    readonly tamanhoGrupo: number;
    readonly maiorCapacidade: number;

    constructor(tamanhoGrupo: number, maiorCapacidade: number) {
        super(
            `Nenhuma mesa do salão acomoda ${tamanhoGrupo} pessoas (a maior tem ${maiorCapacidade} lugares).`
        );
        this.tamanhoGrupo = tamanhoGrupo;
        this.maiorCapacidade = maiorCapacidade;
    }
}

export class PosicaoForaDaPlanta extends ErroDeDominio {
    readonly coluna: number;
    readonly linha: number;

    constructor(coluna: number, linha: number, colunas: number, linhas: number) {
        super(`Posição (${coluna}, ${linha}) está fora da planta, que tem ${colunas} por ${linhas}.`);
        this.coluna = coluna;
        this.linha = linha;
    }
}

export class PosicaoOcupada extends ErroDeDominio {
    readonly mesaId: string;
    readonly ocupadaPor: string;

    constructor(mesaId: string, ocupadaPor: string) {
        super(`Não dá para pôr a mesa "${mesaId}" aí: a mesa "${ocupadaPor}" já está nesse lugar.`);
        this.mesaId = mesaId;
        this.ocupadaPor = ocupadaPor;
    }
}

export class SalaoSemEspaco extends ErroDeDominio {
    constructor() {
        super("Não há ladrilho livre na planta para mais uma mesa.");
    }
}

export class ItemForaDaFila extends ErroDeDominio {
    constructor() {
        super("Este item não está mais na fila de espera.");
    }
}
