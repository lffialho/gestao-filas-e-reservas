import { type Relogio, relogioDoSistema } from "../../compartilhado/tempo/relogio.js";
import type { Cliente } from "./cliente.js";
import { FilaDeEspera, type ItemFila } from "./fila-de-espera.js";
import { Mesa, StatusMesa } from "./mesa.js";
import { COLUNAS_DA_PLANTA, LINHAS_DA_PLANTA, mesmaPosicao, type Posicao } from "./planta.js";
import type { EstadoDoSalao } from "../estado.js";
import {
    CancelamentoInvalido,
    ClienteJaNaFila,
    ClienteJaNoSalao,
    FilaTemPrioridade,
    GrupoSemMesaPossivel,
    IdentidadeDivergente,
    MesaDuplicada,
    MesaNaoEncontrada,
    NumeroDeMesaDuplicado,
    PosicaoOcupada,
    SalaoSemEspaco
} from "../erros.js";

/** Retrato imutável de uma mesa, para leitura fora do domínio. */
export interface InfoMesa {
    id: string;
    numero: number;
    capacidade: number;
    status: StatusMesa;
    cliente: InfoCliente | null;
    posicao: Posicao | null;
    /** ISO 8601 — desde quando a mesa está neste status. */
    desde: string;
}

export interface InfoCliente {
    nome: string;
    telefone: string;
    quantidadePessoas: number;
}

export interface RelatorioDoSalao {
    /** Número puro. A formatação é responsabilidade de quem apresenta. */
    taxaOcupacaoPercentual: number;
    tempoMedioEsperaSegundos: number;
    tamanhoFila: number;
    mesas: InfoMesa[];
}

export interface ResultadoReserva {
    mesaId: string;
    mesaNumero: number;
    cliente: Cliente;
    status: StatusMesa;
}

/** O cliente foi recebido: ou sentou numa mesa, ou entrou na fila. */
export type ResultadoRecepcao =
    | { destino: "mesa"; mesa: InfoMesa }
    | { destino: "fila"; posicao: number; item: ItemFila };

export interface ResultadoLiberacao {
    mesaId: string;
    mesaNumero: number;
    /** Quem ocupava a mesa até agora. */
    clienteAnterior: Cliente;
    /** Quem saiu da fila e ficou com a mesa, ou `null` se ninguém cabia. */
    atendido: Cliente | null;
    status: StatusMesa;
}

/**
 * Cadastrar mesa é, no mesmo instante, uma chance de esvaziar a fila: se
 * alguém que espera cabe na mesa nova, ela já nasce dele. Por isso o cadastro
 * devolve quem foi atendido — o chamador precisa avisar a pessoa.
 */
export interface ResultadoCadastroDeMesa {
    mesa: InfoMesa;
    atendido: Cliente | null;
}

function retratar(mesa: Mesa): InfoMesa {
    const cliente = mesa.clienteAtual;
    return Object.freeze({
        id: mesa.id,
        numero: mesa.numero,
        capacidade: mesa.capacidade,
        status: mesa.status,
        posicao: mesa.posicao,
        desde: mesa.desde.toISOString(),
        cliente:
            cliente === null
                ? null
                : Object.freeze({
                      nome: cliente.nome,
                      telefone: cliente.telefone,
                      quantidadePessoas: cliente.quantidadePessoas
                  })
    });
}

/**
 * O telefone diz *quem* é; o resto dos dados tem de bater. Divergir aqui
 * significa que o pedido fala de outra pessoa, ou que os dados de quem espera
 * mudaram — nos dois casos aceitar em silêncio trocaria alguém da fila.
 */
function conferirIdentidade(naFila: Cliente, recebido: Cliente): void {
    if (naFila.nome === recebido.nome && naFila.quantidadePessoas === recebido.quantidadePessoas) {
        return;
    }
    throw new IdentidadeDivergente(
        naFila.telefone,
        `${naFila.nome} (${naFila.quantidadePessoas}p)`,
        `${recebido.nome} (${recebido.quantidadePessoas}p)`
    );
}

/**
 * O salão é o agregado: mesas e fila de espera precisam mudar juntas para
 * continuarem coerentes — dar uma mesa a alguém é, no mesmo instante, tirá-lo
 * da fila. Por isso a consistência se define aqui, e não por mesa.
 *
 * Tudo nesta classe é síncrono e sem E/S: quem persiste é o repositório, que
 * executa uma operação destas dentro de uma transação. Isso mantém a lógica de
 * alocação testável sem `await` e sem banco.
 */
export class Salao {
    #mesas: Map<string, Mesa>;
    #filaDeEspera: FilaDeEspera;
    #relogio: Relogio;

    constructor(relogio: Relogio = relogioDoSistema, mesas: readonly Mesa[] = []) {
        this.#mesas = new Map<string, Mesa>();
        this.#filaDeEspera = new FilaDeEspera(relogio);
        this.#relogio = relogio;
        for (const mesa of mesas) {
            this.#registrarMesa(mesa);
        }
    }

    /**
     * Cadastra a mesa e, se alguém na fila couber nela, já a entrega a essa
     * pessoa. Sem esse segundo passo o salão consegue ficar com mesa vazia e
     * gente esperando ao mesmo tempo — e esse estado não se desfaz sozinho,
     * porque quem chega depois também vai para trás de quem já esperava.
     */
    adicionarMesa(mesa: Mesa): ResultadoCadastroDeMesa {
        const propria = this.#registrarMesa(mesa);
        const atendido = this.#entregarAoProximoDaFila(propria);
        return { mesa: retratar(propria), atendido };
    }

    /**
     * Põe a mesa no salão sem tocar na fila — é disso que a reconstituição
     * precisa — validando identidade, numeração e lugar na planta. Sem posição
     * declarada, a mesa recebe o primeiro ladrilho livre.
     *
     * A mesa é clonada de propósito: guardar o objeto que veio de fora deixa o
     * chamador mudar o salão depois, sem transação e sem trava. O repositório
     * em memória permitia isso e o SQLite não — os dois têm de concordar.
     */
    #registrarMesa(mesa: Mesa): Mesa {
        if (this.#mesas.has(mesa.id)) {
            throw new MesaDuplicada(mesa.id);
        }
        for (const existente of this.#mesas.values()) {
            if (existente.numero === mesa.numero) {
                throw new NumeroDeMesaDuplicado(mesa.numero, existente.id);
            }
        }

        // O clone herda o relógio do salão: sem isso as transições da mesa
        // marcariam a hora do sistema enquanto a fila conta pelo relógio
        // injetado, e os dois tempos não bateriam.
        const propria = Mesa.reconstituir(mesa.estado(), this.#relogio);
        const desejada = propria.posicao;

        if (desejada === null) {
            propria.moverPara(this.#primeiroLadrilhoLivre());
        } else {
            const ocupante = this.#mesaEm(desejada, propria.id);
            if (ocupante !== null) {
                throw new PosicaoOcupada(propria.id, ocupante.id);
            }
        }

        this.#mesas.set(propria.id, propria);
        return propria;
    }

    /** Arrasta a mesa para outro ladrilho. */
    moverMesa(mesaId: string, posicao: Posicao): InfoMesa {
        const mesa = this.#obterMesa(mesaId);
        const ocupante = this.#mesaEm(posicao, mesaId);

        if (ocupante !== null) {
            throw new PosicaoOcupada(mesaId, ocupante.id);
        }

        mesa.moverPara(posicao);
        return retratar(mesa);
    }

    #mesaEm(posicao: Posicao, ignorandoId: string): Mesa | null {
        for (const mesa of this.#mesas.values()) {
            const dela = mesa.posicao;
            if (mesa.id !== ignorandoId && dela !== null && mesmaPosicao(dela, posicao)) {
                return mesa;
            }
        }
        return null;
    }

    #primeiroLadrilhoLivre(): Posicao {
        for (let linha = 0; linha < LINHAS_DA_PLANTA; linha++) {
            for (let coluna = 0; coluna < COLUNAS_DA_PLANTA; coluna++) {
                if (this.#mesaEm({ coluna, linha }, "") === null) {
                    return { coluna, linha };
                }
            }
        }
        throw new SalaoSemEspaco();
    }

    /** Recria o salão inteiro a partir do estado gravado. */
    static reconstituir(estado: EstadoDoSalao, relogio: Relogio = relogioDoSistema): Salao {
        const salao = new Salao(
            relogio,
            estado.mesas.map((mesa) => Mesa.reconstituir(mesa))
        );
        salao.#filaDeEspera = FilaDeEspera.reconstituir(estado.fila, relogio);
        return salao;
    }

    /**
     * Ordem estável das mesas: pelo número, com o id desempatando. Sem isso a
     * ordem seria a de cadastro em memória e a do `SELECT` no banco — os dois
     * adaptadores devolveriam o mesmo salão em ordens diferentes.
     */
    #mesasOrdenadas(): Mesa[] {
        return Array.from(this.#mesas.values()).sort((a, b) => {
            if (a.numero !== b.numero) {
                return a.numero - b.numero;
            }
            return a.id < b.id ? -1 : 1;
        });
    }

    /** Retrato completo para persistência — ver `EstadoDoSalao`. */
    estado(): EstadoDoSalao {
        return {
            mesas: this.#mesasOrdenadas().map((mesa) => mesa.estado()),
            fila: this.#filaDeEspera.estado()
        };
    }

    #obterMesa(mesaId: string): Mesa {
        const mesa = this.#mesas.get(mesaId);
        if (mesa === undefined) {
            throw new MesaNaoEncontrada(mesaId);
        }
        return mesa;
    }

    /** Leitura: devolve um retrato, não a entidade mutável. */
    consultarMesa(mesaId: string): InfoMesa | undefined {
        const mesa = this.#mesas.get(mesaId);
        return mesa === undefined ? undefined : retratar(mesa);
    }

    get totalDeMesas(): number {
        return this.#mesas.size;
    }

    get tamanhoFila(): number {
        return this.#filaDeEspera.tamanhoDaFila;
    }

    get tempoMedioEsperaSegundos(): number {
        return this.#filaDeEspera.tempoMedioDeEsperaEmSegundos;
    }

    get maiorCapacidade(): number {
        let maior = 0;
        for (const mesa of this.#mesas.values()) {
            maior = Math.max(maior, mesa.capacidade);
        }
        return maior;
    }

    /** Reservada e ocupada contam como ocupação — as duas tiram a mesa de circulação. */
    get taxaDeOcupacao(): number {
        if (this.#mesas.size === 0) {
            return 0;
        }
        const indisponiveis = Array.from(this.#mesas.values()).filter((mesa) => !mesa.estaDisponivel).length;

        return Math.round((indisponiveis / this.#mesas.size) * 100);
    }

    /** Quem está esperando, na ordem de chegada. */
    fila(): ItemFila[] {
        return this.#filaDeEspera.itens();
    }

    relatorio(): RelatorioDoSalao {
        return {
            taxaOcupacaoPercentual: this.taxaDeOcupacao,
            tempoMedioEsperaSegundos: this.tempoMedioEsperaSegundos,
            tamanhoFila: this.tamanhoFila,
            mesas: this.#mesasOrdenadas().map(retratar)
        };
    }

    /** Em que mesa este telefone está sentado, se estiver em alguma. */
    #mesaDoTelefone(telefone: string): Mesa | null {
        for (const mesa of this.#mesas.values()) {
            const ocupante = mesa.clienteAtual;
            if (ocupante !== null && ocupante.telefone === telefone) {
                return mesa;
            }
        }
        return null;
    }

    /**
     * O telefone é a identidade do cliente — é por ele que se desiste da fila e
     * é para ele que o aviso vai. A mesma identidade em duas mesas, ou sentada
     * e esperando ao mesmo tempo, quebra as duas coisas.
     */
    #recusarTelefoneJaNoSalao(telefone: string): void {
        const mesa = this.#mesaDoTelefone(telefone);
        if (mesa !== null) {
            throw new ClienteJaNoSalao(telefone, mesa.id);
        }
        if (this.#filaDeEspera.consultar(telefone) !== null) {
            throw new ClienteJaNaFila(telefone);
        }
    }

    /**
     * Porta de entrada do salão: senta o cliente na melhor mesa livre ou o
     * coloca na fila. É aqui que a ordem de chegada é garantida.
     */
    receberCliente(cliente: Cliente): ResultadoRecepcao {
        this.#recusarTelefoneJaNoSalao(cliente.telefone);

        const maior = this.maiorCapacidade;
        if (cliente.quantidadePessoas > maior) {
            throw new GrupoSemMesaPossivel(cliente.quantidadePessoas, maior);
        }

        const mesa = this.#melhorMesaLivrePara(cliente);
        if (mesa !== null) {
            mesa.reservar(cliente);
            return { destino: "mesa", mesa: retratar(mesa) };
        }

        const item = this.#filaDeEspera.adicionar(cliente);
        return { destino: "fila", posicao: this.#filaDeEspera.tamanhoDaFila, item };
    }

    /**
     * Melhor mesa livre para o grupo: a menor que o acomode, para não gastar
     * uma mesa grande com um casal. Uma mesa é descartada se alguém que já
     * está na fila também caberia nela — quem chegou antes tem prioridade.
     *
     * Quem chega aqui nunca está na fila: `receberCliente` já recusou o
     * telefone repetido antes de chamar.
     */
    #melhorMesaLivrePara(cliente: Cliente): Mesa | null {
        const candidatas = Array.from(this.#mesas.values())
            .filter((mesa) => mesa.estaDisponivel && mesa.podeAcomodar(cliente.quantidadePessoas))
            .sort((a, b) => a.capacidade - b.capacidade);

        for (const mesa of candidatas) {
            if (this.#filaDeEspera.proximoCompativel(mesa.capacidade) === null) {
                return mesa;
            }
        }
        return null;
    }

    /**
     * Coloca o cliente numa mesa escolhida a dedo. Continua valendo a ordem de
     * chegada: se alguém na fila cabe nessa mesa, só ele pode recebê-la — e,
     * nesse caso, quem senta é **o cliente que já estava na fila**, não o que
     * veio no pedido. Casar só pelo telefone e sentar o objeto recebido deixava
     * um erro de digitação do anfitrião tirar uma pessoa da fila e pôr outra no
     * lugar dela, além de perder a hora de chegada original.
     */
    fazerReserva(mesaId: string, cliente: Cliente): ResultadoReserva {
        const mesa = this.#obterMesa(mesaId);
        const esperando = this.#filaDeEspera.proximoCompativel(mesa.capacidade);

        if (esperando !== null && esperando.cliente.telefone !== cliente.telefone) {
            throw new FilaTemPrioridade(mesa.id, esperando.cliente.nome);
        }

        const jaSentado = this.#mesaDoTelefone(cliente.telefone);
        if (jaSentado !== null) {
            throw new ClienteJaNoSalao(cliente.telefone, jaSentado.id);
        }

        if (esperando === null) {
            // Ninguém na fila cabe nesta mesa. Se este cliente está na fila, é
            // porque não cabe aqui: sentá-lo o deixaria em dois lugares.
            if (this.#filaDeEspera.consultar(cliente.telefone) !== null) {
                throw new ClienteJaNaFila(cliente.telefone);
            }
            mesa.reservar(cliente);
            return { mesaId: mesa.id, mesaNumero: mesa.numero, cliente, status: mesa.status };
        }

        conferirIdentidade(esperando.cliente, cliente);
        mesa.reservar(esperando.cliente);
        this.#filaDeEspera.confirmarAtendimento(esperando);

        return {
            mesaId: mesa.id,
            mesaNumero: mesa.numero,
            cliente: esperando.cliente,
            status: mesa.status
        };
    }

    /** O grupo que reservou chegou e sentou. */
    ocuparMesa(mesaId: string): InfoMesa {
        const mesa = this.#obterMesa(mesaId);
        mesa.ocupar();
        return retratar(mesa);
    }

    entrarNaFila(cliente: Cliente): ItemFila {
        this.#recusarTelefoneJaNoSalao(cliente.telefone);
        return this.#filaDeEspera.adicionar(cliente);
    }

    /** Desistência: sai da fila de espera. Não mexe em mesa nenhuma. */
    sairDaFila(telefone: string): ItemFila | null {
        return this.#filaDeEspera.remover(telefone);
    }

    /** O grupo foi embora: a mesa vira e o próximo da fila que couber assume. */
    liberarMesa(mesaId: string): ResultadoLiberacao {
        return this.#desocupar(mesaId, null);
    }

    /** A reserva não vem mais: a mesa vira e o próximo da fila que couber assume. */
    cancelarReserva(mesaId: string): ResultadoLiberacao {
        return this.#desocupar(mesaId, (mesa) => {
            if (mesa.status !== StatusMesa.RESERVADA) {
                throw new CancelamentoInvalido(mesa.id, mesa.status);
            }
        });
    }

    /**
     * Entrega a mesa ao primeiro da fila que couber nela, se houver algum.
     * A mesa aceita primeiro; só depois o cliente sai da fila, para que uma
     * falha no meio não some com ninguém.
     */
    #entregarAoProximoDaFila(mesa: Mesa): Cliente | null {
        if (!mesa.estaDisponivel) {
            return null;
        }

        const proximo = this.#filaDeEspera.proximoCompativel(mesa.capacidade);
        if (proximo === null) {
            return null;
        }

        mesa.reservar(proximo.cliente);
        this.#filaDeEspera.confirmarAtendimento(proximo);
        return proximo.cliente;
    }

    #desocupar(mesaId: string, validar: ((mesa: Mesa) => void) | null): ResultadoLiberacao {
        const mesa = this.#obterMesa(mesaId);
        if (validar !== null) {
            validar(mesa);
        }

        const clienteAnterior = mesa.liberar();
        const atendido = this.#entregarAoProximoDaFila(mesa);

        return {
            mesaId: mesa.id,
            mesaNumero: mesa.numero,
            clienteAnterior,
            atendido,
            status: mesa.status
        };
    }
}
