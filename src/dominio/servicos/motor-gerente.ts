import type { Cliente } from "../entidades/cliente.js";
import type { ItemFila } from "../entidades/fila-de-espera.js";
import type { Mesa } from "../entidades/mesa.js";
import type {
    InfoMesa,
    RelatorioDoSalao,
    ResultadoLiberacao,
    ResultadoRecepcao,
    ResultadoReserva
} from "../entidades/salao.js";
import type { RepositorioDoSalao } from "../portas/repositorio-do-salao.js";

export type {
    InfoCliente,
    InfoMesa,
    RelatorioDoSalao,
    ResultadoLiberacao,
    ResultadoRecepcao,
    ResultadoReserva
} from "../entidades/salao.js";

/**
 * Serviço de aplicação. Não guarda estado: cada operação é uma transação no
 * repositório, e a regra de negócio mora no agregado `Salao`.
 *
 * Uma operação por transação também significa que duas chamadas nunca se
 * entrelaçam — o que era garantido por acidente, quando o estado morava aqui
 * dentro, agora é garantido pelo contrato do repositório.
 */
export class MotorGerente {
    #repositorio: RepositorioDoSalao;

    constructor(repositorio: RepositorioDoSalao) {
        this.#repositorio = repositorio;
    }

    async adicionarMesa(mesa: Mesa): Promise<void> {
        return this.#repositorio.transacao((salao) => {
            salao.adicionarMesa(mesa);
        });
    }

    async consultarMesa(mesaId: string): Promise<InfoMesa | undefined> {
        return this.#repositorio.transacao((salao) => salao.consultarMesa(mesaId));
    }

    async totalDeMesas(): Promise<number> {
        return this.#repositorio.transacao((salao) => salao.totalDeMesas);
    }

    async tamanhoFilaEspera(): Promise<number> {
        return this.#repositorio.transacao((salao) => salao.tamanhoFila);
    }

    async tempoMedioEspera(): Promise<number> {
        return this.#repositorio.transacao((salao) => salao.tempoMedioEsperaSegundos);
    }

    async maiorCapacidade(): Promise<number> {
        return this.#repositorio.transacao((salao) => salao.maiorCapacidade);
    }

    async taxaDeOcupacao(): Promise<number> {
        return this.#repositorio.transacao((salao) => salao.taxaDeOcupacao);
    }

    async gerarRelatorio(): Promise<RelatorioDoSalao> {
        return this.#repositorio.transacao((salao) => salao.relatorio());
    }

    /** Recebe quem chegou: senta na melhor mesa livre ou põe na fila. */
    async receberCliente(cliente: Cliente): Promise<ResultadoRecepcao> {
        return this.#repositorio.transacao((salao) => salao.receberCliente(cliente));
    }

    /** Coloca o cliente numa mesa escolhida a dedo, sem furar a fila. */
    async fazerReserva(mesaId: string, cliente: Cliente): Promise<ResultadoReserva> {
        return this.#repositorio.transacao((salao) => salao.fazerReserva(mesaId, cliente));
    }

    async ocuparMesa(mesaId: string): Promise<InfoMesa> {
        return this.#repositorio.transacao((salao) => salao.ocuparMesa(mesaId));
    }

    async entrarNaFila(cliente: Cliente): Promise<ItemFila> {
        return this.#repositorio.transacao((salao) => salao.entrarNaFila(cliente));
    }

    async sairDaFila(telefone: string): Promise<ItemFila | null> {
        return this.#repositorio.transacao((salao) => salao.sairDaFila(telefone));
    }

    async liberarMesa(mesaId: string): Promise<ResultadoLiberacao> {
        return this.#repositorio.transacao((salao) => salao.liberarMesa(mesaId));
    }

    async cancelarReserva(mesaId: string): Promise<ResultadoLiberacao> {
        return this.#repositorio.transacao((salao) => salao.cancelarReserva(mesaId));
    }
}
