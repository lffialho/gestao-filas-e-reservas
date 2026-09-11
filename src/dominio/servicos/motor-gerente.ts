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
import type { Notificador } from "../portas/notificador.js";
import type { RepositorioDoSalao } from "../portas/repositorio-do-salao.js";
import {
    descreverErro,
    registradorSilencioso,
    type Registrador
} from "../../compartilhado/log/registrador.js";

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
export interface OpcoesDoMotor {
    /** Sem notificador, quem sai da fila para a mesa não é avisado. */
    notificador?: Notificador | undefined;
    registrador?: Registrador | undefined;
}

export class MotorGerente {
    #repositorio: RepositorioDoSalao;
    #notificador: Notificador | null;
    #registrador: Registrador;

    constructor(repositorio: RepositorioDoSalao, opcoes: OpcoesDoMotor = {}) {
        this.#repositorio = repositorio;
        this.#notificador = opcoes.notificador ?? null;
        this.#registrador = opcoes.registrador ?? registradorSilencioso;
    }

    /**
     * Avisa quem saiu da fila para a mesa. Chamado **depois** da transação
     * confirmar, e nunca propaga erro: a mesa já é daquele cliente, então
     * provedor de aviso fora do ar não pode desfazer o atendimento.
     */
    async #avisarAtendido(resultado: ResultadoLiberacao): Promise<void> {
        const atendido = resultado.atendido;
        if (atendido === null || this.#notificador === null) {
            return;
        }

        try {
            await this.#notificador.mesaPronta({
                nome: atendido.nome,
                telefone: atendido.telefone,
                mesaId: resultado.mesaId,
                mesaNumero: resultado.mesaNumero
            });
        } catch (erro) {
            this.#registrador.erro("aviso_mesa_pronta_falhou", {
                telefone: atendido.telefone,
                mesaId: resultado.mesaId,
                ...descreverErro(erro)
            });
        }
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

    /**
     * Coloca o cliente numa mesa escolhida a dedo, sem furar a fila.
     *
     * Não avisa ninguém de propósito: aqui é o anfitrião sentando alguém que
     * está na sua frente. O aviso serve para quem foi embora esperar e precisa
     * ser chamado de volta, o que acontece em liberarMesa e cancelarReserva.
     */
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
        const resultado = await this.#repositorio.transacao((salao) => salao.liberarMesa(mesaId));
        await this.#avisarAtendido(resultado);
        return resultado;
    }

    async cancelarReserva(mesaId: string): Promise<ResultadoLiberacao> {
        const resultado = await this.#repositorio.transacao((salao) => salao.cancelarReserva(mesaId));
        await this.#avisarAtendido(resultado);
        return resultado;
    }
}
