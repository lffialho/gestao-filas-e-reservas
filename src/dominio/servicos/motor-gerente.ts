import type { Cliente } from "../entidades/cliente.js";
import type { ItemFila } from "../entidades/fila-de-espera.js";
import type { Mesa } from "../entidades/mesa.js";
import type { Posicao } from "../entidades/planta.js";
import type {
    InfoMesa,
    Previsao,
    RelatorioDoSalao,
    ResultadoCadastroDeMesa,
    ResultadoLiberacao,
    ResultadoRecepcao,
    ResultadoReserva
} from "../entidades/salao.js";
import type { Notificador } from "../portas/notificador.js";
import type { EventoDoSalao, Periodo } from "../eventos.js";
import type { RepositorioDoSalao } from "../portas/repositorio-do-salao.js";
import { resumirPeriodo, type ResumoDoPeriodo } from "./resumo.js";
import {
    descreverErro,
    registradorSilencioso,
    type Registrador
} from "../../compartilhado/log/registrador.js";

export type { ResumoDoPeriodo, ResumoPorMesa } from "./resumo.js";
export type {
    InfoCliente,
    InfoMesa,
    Previsao,
    RelatorioDoSalao,
    ResultadoCadastroDeMesa,
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
     * Avisa quem saiu da fila para a mesa. Chamado depois da transação
     * confirmar, e nunca propaga erro: a mesa já é daquele cliente, então
     * provedor de aviso fora do ar não pode desfazer o atendimento.
     */
    async #avisarAtendido(resultado: {
        mesaId: string;
        mesaNumero: number;
        atendido: Cliente | null;
    }): Promise<void> {
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

    /**
     * Cadastra a mesa. Se alguém da fila couber nela, o salão já a entrega a
     * essa pessoa — e aí ela precisa ser avisada, como em qualquer outra saída
     * da fila.
     */
    async adicionarMesa(mesa: Mesa): Promise<ResultadoCadastroDeMesa> {
        const resultado = await this.#repositorio.transacao((salao) => salao.adicionarMesa(mesa));
        await this.#avisarAtendido({
            mesaId: resultado.mesa.id,
            mesaNumero: resultado.mesa.numero,
            atendido: resultado.atendido
        });
        return resultado;
    }

    /** Tira a mesa da planta. Só sai mesa livre. */
    async removerMesa(mesaId: string): Promise<InfoMesa> {
        return this.#repositorio.transacao((salao) => salao.removerMesa(mesaId));
    }

    /**
     * O direito ao esquecimento: tira nome e telefone deste cliente do diário.
     *
     * Não passa por `transacao` porque não mexe no salão — quem está sentado
     * agora continua sentado, e o relatório continua contando o atendimento.
     * O que sai é só o que identifica a pessoa.
     */
    async esquecerCliente(telefone: string): Promise<{ eventosAlterados: number }> {
        const eventosAlterados = await this.#repositorio.esquecerTelefone(telefone);
        this.#registrador.info("cliente_esquecido", { eventosAlterados });
        return { eventosAlterados };
    }

    /** Anonimiza o diário mais velho que o limite. Devolve quantos mudaram. */
    async anonimizarDiarioAte(limite: Date): Promise<number> {
        return this.#repositorio.anonimizarEventosAte(limite);
    }

    async consultarMesa(mesaId: string): Promise<InfoMesa | undefined> {
        return this.#repositorio.consulta((salao) => salao.consultarMesa(mesaId));
    }

    async totalDeMesas(): Promise<number> {
        return this.#repositorio.consulta((salao) => salao.totalDeMesas);
    }

    async tamanhoFilaEspera(): Promise<number> {
        return this.#repositorio.consulta((salao) => salao.tamanhoFila);
    }

    async tempoMedioEspera(): Promise<number> {
        return this.#repositorio.consulta((salao) => salao.tempoMedioEsperaSegundos);
    }

    async maiorCapacidade(): Promise<number> {
        return this.#repositorio.consulta((salao) => salao.maiorCapacidade);
    }

    async taxaDeOcupacao(): Promise<number> {
        return this.#repositorio.consulta((salao) => salao.taxaDeOcupacao);
    }

    async consultarFila(): Promise<ItemFila[]> {
        return this.#repositorio.consulta((salao) => salao.fila());
    }

    async gerarRelatorio(): Promise<RelatorioDoSalao> {
        return this.#repositorio.consulta((salao) => salao.relatorio());
    }

    /** Fechamento do período: lê o diário e o resume. */
    async resumirPeriodo(periodo: Periodo): Promise<ResumoDoPeriodo> {
        return resumirPeriodo(await this.#repositorio.eventos(periodo));
    }

    /**
     * O diário cru do período. O resumo responde "como foi a noite"; isto
     * responde "o que acabou de acontecer", que é outra pergunta e tem outro
     * leitor — quem opera o salão agora, e não quem fecha o caixa.
     */
    async eventos(periodo: Periodo): Promise<EventoDoSalao[]> {
        return this.#repositorio.eventos(periodo);
    }

    /**
     * Onde este grupo iria parar, sem mudar nada. Vai por `consulta`, e não por
     * `transacao`: perguntar não pode tomar a trava de escrita do banco, senão
     * um painel digitando um nome atrapalharia quem está sentando gente.
     */
    async preverRecepcao(pessoas: number, telefone: string | null): Promise<Previsao> {
        return this.#repositorio.consulta((salao) => salao.preverRecepcao(pessoas, telefone));
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

    /** Arrasta a mesa para outro ladrilho da planta. */
    async moverMesa(mesaId: string, posicao: Posicao): Promise<InfoMesa> {
        return this.#repositorio.transacao((salao) => salao.moverMesa(mesaId, posicao));
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
