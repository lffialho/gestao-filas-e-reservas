import { TravaAssincrona } from "../../compartilhado/assincrono/trava-assincrona.js";
import { type Relogio, relogioDoSistema } from "../../compartilhado/tempo/relogio.js";
import { type Mesa } from "../../dominio/entidades/mesa.js";
import { Salao } from "../../dominio/entidades/salao.js";
import { type RepositorioDoSalao } from "../../dominio/portas/repositorio-do-salao.js";

const CHAVE_SALAO = "salao";

export interface OpcoesDoRepositorioEmMemoria {
    /** Mesas do salão — configuração de abertura, não operação de runtime. */
    mesas?: readonly Mesa[] | undefined;
    relogio?: Relogio | undefined;
}

/**
 * Guarda o salão na memória do processo. É a implementação de teste e a de
 * desenvolvimento; serve também em produção enquanto houver um único processo
 * e o estado puder ser perdido num reinício.
 *
 * A transação é uma trava: as operações sobre o salão são serializadas, de modo
 * que nenhuma enxerga o salão no meio de uma mudança de outra. Como a operação
 * é síncrona, isso basta — não há `await` dentro da seção crítica por onde uma
 * segunda operação pudesse entrar.
 */
export class RepositorioDoSalaoEmMemoria implements RepositorioDoSalao {
    #salao: Salao;
    #trava: TravaAssincrona;

    constructor(opcoes: OpcoesDoRepositorioEmMemoria = {}) {
        this.#salao = new Salao(opcoes.relogio ?? relogioDoSistema, opcoes.mesas ?? []);
        this.#trava = new TravaAssincrona();
    }

    async transacao<T>(operacao: (salao: Salao) => T): Promise<T> {
        return this.#trava.executarComExclusividade(CHAVE_SALAO, () => operacao(this.#salao));
    }
}
