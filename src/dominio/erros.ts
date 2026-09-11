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

export class ItemForaDaFila extends ErroDeDominio {
    constructor() {
        super("Este item não está mais na fila de espera.");
    }
}
