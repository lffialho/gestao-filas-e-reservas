import { TravaAssincrona } from "../../compartilhado/assincrono/trava-assincrona.js";
import { type Relogio, relogioDoSistema } from "../../compartilhado/tempo/relogio.js";
import type { Mesa } from "../../dominio/entidades/mesa.js";
import { Salao } from "../../dominio/entidades/salao.js";
import type { RepositorioDoSalao } from "../../dominio/portas/repositorio-do-salao.js";

const CHAVE_SALAO = "salao";

export interface OpcoesDoRepositorioEmMemoria {
    /** Mesas do salão — configuração de abertura, não operação de runtime. */
    mesas?: readonly Mesa[] | undefined;
    relogio?: Relogio | undefined;
}

/**
 * Guarda o salão na memória do processo. É a implementação de teste e de
 * desenvolvimento; serve também em produção enquanto houver um único processo
 * e o estado puder ser perdido num reinício.
 *
 * Duas coisas fazem dela uma transação de verdade, e não só uma chamada:
 *
 * - a trava serializa as operações, de modo que nenhuma enxergue o salão no
 *   meio de uma mudança de outra. Como a operação é síncrona, isso basta: não
 *   há `await` na seção crítica por onde uma segunda pudesse entrar;
 * - o estado é fotografado antes e restaurado se a operação lançar. Sem isso,
 *   uma operação que mudasse o salão e falhasse depois deixaria a mudança
 *   pela metade — e o contrato promete tudo ou nada. A cópia é barata porque o
 *   agregado é pequeno.
 */
export class RepositorioDoSalaoEmMemoria implements RepositorioDoSalao {
    #salao: Salao;
    #trava: TravaAssincrona;
    #relogio: Relogio;

    constructor(opcoes: OpcoesDoRepositorioEmMemoria = {}) {
        this.#relogio = opcoes.relogio ?? relogioDoSistema;
        this.#salao = new Salao(this.#relogio, opcoes.mesas ?? []);
        this.#trava = new TravaAssincrona();
    }

    async transacao<T>(operacao: (salao: Salao) => T): Promise<T> {
        return this.#trava.executarComExclusividade(CHAVE_SALAO, () => {
            const anterior = this.#salao.estado();
            try {
                return operacao(this.#salao);
            } catch (erro) {
                this.#salao = Salao.reconstituir(anterior, this.#relogio);
                throw erro;
            }
        });
    }
}
