import { Cliente } from "./cliente.js";
import { type Relogio, relogioDoSistema } from "../../compartilhado/tempo/relogio.js";
import type { EstadoDaFila } from "../estado.js";
import { ClienteJaNaFila, DadosInvalidos, ItemForaDaFila } from "../erros.js";

export interface ItemFila {
    cliente: Cliente;
    dataEntrada: Date;
    dataAtendimento?: Date;
}

/**
 * Cópia congelada de um item: é isto que sai da fila para fora do domínio.
 * Devolver o item vivo deixaria quem chamou escrever em `dataAtendimento` —
 * campo que só a fila pode preencher — sem passar por transação nenhuma.
 */
function retratar(item: ItemFila): ItemFila {
    return Object.freeze(
        item.dataAtendimento === undefined
            ? { cliente: item.cliente, dataEntrada: new Date(item.dataEntrada) }
            : {
                  cliente: item.cliente,
                  dataEntrada: new Date(item.dataEntrada),
                  dataAtendimento: new Date(item.dataAtendimento)
              }
    );
}

export class FilaDeEspera {
    #clientes: ItemFila[];
    #somaDeEsperas: number;
    #atendimentos: number;
    #relogio: Relogio;

    constructor(relogio: Relogio = relogioDoSistema) {
        this.#clientes = [];
        this.#somaDeEsperas = 0;
        this.#atendimentos = 0;
        this.#relogio = relogio;
    }

    adicionar(cliente: Cliente): ItemFila {
        if (this.#clientes.some((item) => item.cliente.telefone === cliente.telefone)) {
            throw new ClienteJaNaFila(cliente.telefone);
        }

        const novoCadastro: ItemFila = {
            cliente,
            dataEntrada: this.#relogio.agora()
        };
        this.#clientes.push(novoCadastro);
        return retratar(novoCadastro);
    }

    /** Quem está na fila com este telefone, ou `null`. Só para leitura. */
    consultar(telefone: string): ItemFila | null {
        const item = this.#clientes.find((cadastro) => cadastro.cliente.telefone === telefone);
        return item === undefined ? null : retratar(item);
    }

    remover(telefone: string): ItemFila | null {
        const index = this.#clientes.findIndex((item) => item.cliente.telefone === telefone);

        if (index === -1) {
            return null;
        }
        const [clienteRemovido] = this.#clientes.splice(index, 1);
        return clienteRemovido === undefined ? null : retratar(clienteRemovido);
    }

    /**
     * Espia o primeiro da fila que cabe na mesa, SEM removê-lo. Quem chama
     * confirma com `confirmarAtendimento` só depois de a mesa aceitar a
     * reserva — assim uma falha no meio não some com o cliente.
     */
    proximoCompativel(capacidadeDaMesa: number): ItemFila | null {
        return this.#clientes.find((item) => item.cliente.quantidadePessoas <= capacidadeDaMesa) ?? null;
    }

    /**
     * Tira o item da fila, contabiliza quanto ele esperou e devolve o retrato
     * final. Casa pelo telefone, não pela identidade do objeto: quem chama
     * recebe cópias congeladas, e exigir a instância interna deixaria a API
     * dependente de um detalhe que ela mesma esconde.
     *
     * A espera é medida pela entrada guardada aqui, não pela do item recebido —
     * assim ninguém de fora consegue inflar o tempo médio.
     */
    confirmarAtendimento(item: ItemFila): ItemFila {
        const index = this.#clientes.findIndex(
            (cadastro) => cadastro.cliente.telefone === item.cliente.telefone
        );
        const confirmado = index === -1 ? undefined : this.#clientes[index];
        if (confirmado === undefined) {
            throw new ItemForaDaFila();
        }
        this.#clientes.splice(index, 1);

        const atendimento = this.#relogio.agora();
        confirmado.dataAtendimento = atendimento;
        this.#somaDeEsperas += Math.floor((atendimento.getTime() - confirmado.dataEntrada.getTime()) / 1000);
        this.#atendimentos += 1;
        return retratar(confirmado);
    }

    get tempoMedioDeEsperaEmSegundos(): number {
        if (this.#atendimentos === 0) {
            return 0;
        }
        return Math.round(this.#somaDeEsperas / this.#atendimentos);
    }

    get tamanhoDaFila(): number {
        return this.#clientes.length;
    }

    /** Cópias congeladas dos itens, na ordem de chegada. Para leitura. */
    itens(): ItemFila[] {
        return this.#clientes.map(retratar);
    }

    estaVazia(): boolean {
        return this.#clientes.length === 0;
    }

    /**
     * Recria a fila a partir do estado gravado, preservando a ordem dos itens
     * e o histórico de esperas já contabilizadas — sem ele o tempo médio
     * voltaria a zero a cada reinício.
     */
    static reconstituir(estado: EstadoDaFila, relogio: Relogio = relogioDoSistema): FilaDeEspera {
        const fila = new FilaDeEspera(relogio);

        for (const item of estado.itens) {
            const entrada = new Date(item.dataEntrada);
            if (Number.isNaN(entrada.getTime())) {
                throw new DadosInvalidos(`Data de entrada inválida na fila: ${item.dataEntrada}.`);
            }

            const reconstituido: ItemFila = {
                cliente: Cliente.reconstituir(item.cliente),
                dataEntrada: entrada
            };
            if (item.dataAtendimento !== null) {
                reconstituido.dataAtendimento = new Date(item.dataAtendimento);
            }
            fila.#clientes.push(reconstituido);
        }

        const { somaEmSegundos, atendimentos } = estado.esperas;
        if (!Number.isInteger(atendimentos) || atendimentos < 0) {
            throw new DadosInvalidos(`Contagem de atendimentos inválida: ${atendimentos}.`);
        }
        if (!Number.isFinite(somaEmSegundos) || somaEmSegundos < 0) {
            throw new DadosInvalidos(`Soma de esperas inválida: ${somaEmSegundos}.`);
        }
        if (atendimentos === 0 && somaEmSegundos !== 0) {
            throw new DadosInvalidos("Há soma de esperas sem nenhum atendimento contabilizado.");
        }
        fila.#somaDeEsperas = somaEmSegundos;
        fila.#atendimentos = atendimentos;

        return fila;
    }

    estado(): EstadoDaFila {
        return {
            itens: this.#clientes.map((item) => ({
                cliente: item.cliente.estado(),
                dataEntrada: item.dataEntrada.toISOString(),
                dataAtendimento: item.dataAtendimento?.toISOString() ?? null
            })),
            esperas: { somaEmSegundos: this.#somaDeEsperas, atendimentos: this.#atendimentos }
        };
    }
}
