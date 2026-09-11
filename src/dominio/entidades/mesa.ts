import { Cliente } from "./cliente.js";
import type { EstadoDaMesa } from "../estado.js";
import { COLUNAS_DA_PLANTA, dentroDaPlanta, LINHAS_DA_PLANTA, type Posicao } from "./planta.js";
import {
    CapacidadeInsuficiente,
    DadosInvalidos,
    MesaIndisponivel,
    MesaJaDisponivel,
    PosicaoForaDaPlanta,
    TransicaoInvalida
} from "../erros.js";

export enum StatusMesa {
    DISPONIVEL = "DISPONIVEL",
    RESERVADA = "RESERVADA",
    OCUPADA = "OCUPADA"
}

/**
 * Ciclo de vida: DISPONIVEL → RESERVADA → OCUPADA → DISPONIVEL.
 * Uma mesa que não está DISPONIVEL sempre tem um cliente associado.
 */
export class Mesa {
    #id: string;
    #numero: number;
    #capacidade: number;
    #status: StatusMesa;
    #clienteAtual: Cliente | null;
    #posicao: Posicao | null;

    constructor(id: string, numero: number, capacidade: number, posicao?: Posicao) {
        if (id.trim() === "") {
            throw new DadosInvalidos("O id da mesa não pode ser vazio.");
        }
        if (!Number.isInteger(numero) || numero < 1) {
            throw new DadosInvalidos(
                `Número de mesa inválido: ${numero}. Informe um inteiro maior que zero.`
            );
        }
        if (!Number.isInteger(capacidade) || capacidade < 1) {
            throw new DadosInvalidos(`Capacidade inválida para a mesa "${id}": ${capacidade}.`);
        }

        this.#id = id.trim();
        this.#numero = numero;
        this.#capacidade = capacidade;
        this.#status = StatusMesa.DISPONIVEL;
        this.#clienteAtual = null;
        this.#posicao = null;

        if (posicao !== undefined) {
            this.moverPara(posicao);
        }
    }

    get id(): string {
        return this.#id;
    }

    get numero(): number {
        return this.#numero;
    }

    get capacidade(): number {
        return this.#capacidade;
    }

    get status(): StatusMesa {
        return this.#status;
    }

    get clienteAtual(): Cliente | null {
        return this.#clienteAtual;
    }

    /** Onde a mesa está na planta. `null` até o salão a colocar. */
    get posicao(): Posicao | null {
        return this.#posicao === null ? null : { ...this.#posicao };
    }

    /**
     * Põe a mesa num ladrilho. Valida os limites da planta; garantir que o
     * ladrilho está livre é do salão, que é quem conhece as outras mesas.
     */
    moverPara(posicao: Posicao): void {
        if (!dentroDaPlanta(posicao)) {
            throw new PosicaoForaDaPlanta(posicao.coluna, posicao.linha, COLUNAS_DA_PLANTA, LINHAS_DA_PLANTA);
        }
        this.#posicao = { coluna: posicao.coluna, linha: posicao.linha };
    }

    get estaDisponivel(): boolean {
        return this.#status === StatusMesa.DISPONIVEL;
    }

    podeAcomodar(tamanhoGrupo: number): boolean {
        return tamanhoGrupo <= this.#capacidade;
    }

    /** O tamanho do grupo vem do próprio cliente — não há segundo número a divergir. */
    reservar(cliente: Cliente): void {
        if (this.#status !== StatusMesa.DISPONIVEL) {
            throw new MesaIndisponivel(this.#id, this.#status);
        }
        if (!this.podeAcomodar(cliente.quantidadePessoas)) {
            throw new CapacidadeInsuficiente(this.#id, this.#capacidade, cliente.quantidadePessoas);
        }
        this.#status = StatusMesa.RESERVADA;
        this.#clienteAtual = cliente;
    }

    /** O grupo que reservou chegou e sentou. */
    ocupar(): void {
        if (this.#status !== StatusMesa.RESERVADA) {
            throw new TransicaoInvalida(this.#id, this.#status, "ocupar");
        }
        this.#status = StatusMesa.OCUPADA;
    }

    /**
     * Recria uma mesa a partir do estado gravado, validando o que o banco
     * afirma: o status tem de ser conhecido, e a regra de que uma mesa fora de
     * DISPONIVEL sempre tem cliente vale aqui também — dado corrompido não
     * entra no domínio disfarçado de estado válido.
     */
    static reconstituir(estado: EstadoDaMesa): Mesa {
        const mesa = new Mesa(estado.id, estado.numero, estado.capacidade);
        if (estado.posicao !== null) {
            mesa.moverPara(estado.posicao);
        }

        if (!Object.values(StatusMesa).includes(estado.status)) {
            throw new DadosInvalidos(`Status desconhecido para a mesa "${estado.id}": ${estado.status}.`);
        }
        if (estado.status === StatusMesa.DISPONIVEL) {
            if (estado.cliente !== null) {
                throw new DadosInvalidos(`Mesa "${estado.id}" está disponível mas tem cliente associado.`);
            }
            return mesa;
        }
        if (estado.cliente === null) {
            throw new DadosInvalidos(`Mesa "${estado.id}" está ${estado.status} mas sem cliente.`);
        }

        mesa.#status = estado.status;
        mesa.#clienteAtual = Cliente.reconstituir(estado.cliente);
        return mesa;
    }

    estado(): EstadoDaMesa {
        return {
            id: this.#id,
            numero: this.#numero,
            capacidade: this.#capacidade,
            status: this.#status,
            cliente: this.#clienteAtual === null ? null : this.#clienteAtual.estado(),
            posicao: this.posicao
        };
    }

    /** Devolve quem estava na mesa, para que o chamador possa informar. */
    liberar(): Cliente {
        if (this.#status === StatusMesa.DISPONIVEL) {
            throw new MesaJaDisponivel(this.#id);
        }
        const anterior = this.#clienteAtual;
        if (anterior === null) {
            throw new TransicaoInvalida(this.#id, this.#status, "liberar");
        }
        this.#status = StatusMesa.DISPONIVEL;
        this.#clienteAtual = null;
        return anterior;
    }
}
