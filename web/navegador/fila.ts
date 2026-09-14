import type { InfoMesa, ItemFilaJson } from "./api.js";
import { casa } from "./busca.js";
import { el } from "./dom.js";
import { marcarRelogio } from "./relogios.js";

/**
 * A fila, em ordem de chegada.
 *
 * Quantos cabem na tira depende do tamanho da casa, e é justamente por isso que
 * o primeiro da fila é desenhado por inteiro e o resto, resumido: num salão de
 * cinco mesas a fila tem três nomes e cabe toda; num de quarenta ela tem
 * trinta, e ninguém opera lendo trinta cartões. O que o maître precisa saber
 * sempre é quem é o próximo e onde essa pessoa cabe.
 */

/** Quantos da fila aparecem depois do próximo antes de virar "+N esperando". */
const CARTOES_DEPOIS_DO_PROXIMO = 3;

/** Acima disso, listar os números das mesas vira parede de texto. */
const MESAS_QUE_CABEM_NA_FRASE = 5;

function lugaresVagos(pessoas: number): HTMLElement {
    const fileira = el("span", { classe: "espera__lugares" });
    for (let i = 0; i < pessoas; i++) {
        fileira.append(el("span", { classe: "lugar vago" }));
    }
    return fileira;
}

function listar(numeros: readonly number[]): string {
    if (numeros.length <= 1) {
        return numeros.join("");
    }
    return `${numeros.slice(0, -1).join(", ")} e ${numeros.slice(-1).join("")}`;
}

/**
 * Onde o próximo da fila pode sentar. Sai da capacidade, não do status: a
 * pergunta é "que mesas servem para este grupo", e a resposta continua valendo
 * quando todas estiverem ocupadas — é o que diz se vale a pena esperar.
 */
function ondeCabe(mesas: readonly InfoMesa[], pessoas: number): HTMLElement {
    const cabem = mesas.filter((mesa) => mesa.capacidade >= pessoas);

    if (cabem.length === 0) {
        return el("span", {
            classe: "proximo__destino proximo__destino--sem-saida",
            texto: `Nenhuma mesa do salão comporta ${pessoas} ${pessoas === 1 ? "pessoa" : "pessoas"}.`
        });
    }

    if (cabem.length > MESAS_QUE_CABEM_NA_FRASE) {
        return el("span", {
            classe: "proximo__destino",
            texto: `Cabe em ${cabem.length} das ${mesas.length} mesas — espera a primeira que vagar.`
        });
    }

    const numeros = cabem.map((mesa) => mesa.numero).sort((a, b) => a - b);
    return el("span", {
        classe: "proximo__destino",
        texto:
            numeros.length === 1
                ? `Espera a mesa ${listar(numeros)} vagar.`
                : `Espera a primeira que vagar entre as mesas ${listar(numeros)}.`
    });
}

function classesDe(base: string, item: ItemFilaJson, termo: string): string {
    if (termo === "") {
        return base;
    }
    return `${base} ${casa(termo, item.cliente.nome, item.cliente.telefone) ? "achada" : "apagada"}`;
}

function desenharProximo(item: ItemFilaJson, mesas: readonly InfoMesa[], termo: string): HTMLElement {
    const pessoas = item.cliente.quantidadePessoas;

    return el(
        "button",
        {
            classe: classesDe("proximo", item, termo),
            dados: { telefone: item.cliente.telefone },
            atributos: { type: "button" }
        },
        el(
            "span",
            { classe: "proximo__topo" },
            el("span", { classe: "rotulo", texto: "Próximo" }),
            lugaresVagos(pessoas)
        ),
        el(
            "span",
            { classe: "proximo__quem" },
            el("span", { classe: "proximo__nome", texto: item.cliente.nome }),
            marcarRelogio(el("span", { classe: "proximo__relogio mono" }), "espera", item.dataEntrada)
        ),
        ondeCabe(mesas, pessoas)
    );
}

function desenharEspera(item: ItemFilaJson, posicao: number, termo: string): HTMLElement {
    return el(
        "button",
        {
            classe: classesDe("espera", item, termo),
            dados: { telefone: item.cliente.telefone },
            atributos: { type: "button" }
        },
        el(
            "span",
            { classe: "espera__topo mono" },
            el("span", { texto: `${posicao}º` }),
            marcarRelogio(el("span", {}), "espera", item.dataEntrada)
        ),
        el("span", { classe: "espera__nome", texto: item.cliente.nome }),
        lugaresVagos(item.cliente.quantidadePessoas)
    );
}

export function desenharFila(
    itens: readonly ItemFilaJson[],
    mesas: readonly InfoMesa[],
    termo: string
): HTMLElement[] {
    const pessoas = itens.reduce((soma, item) => soma + item.cliente.quantidadePessoas, 0);

    const contador = el(
        "div",
        { classe: "fila__contador" },
        el("span", { classe: "rotulo", texto: "Fila" }),
        el("span", { classe: "fila__numero mono", texto: String(itens.length) }),
        el("span", {
            classe: "fila__nota",
            texto: itens.length === 0 ? "ninguém esperando" : `${pessoas} pessoas, por ordem de chegada`
        })
    );

    const [proximo, ...resto] = itens;
    if (proximo === undefined) {
        return [
            contador,
            el("div", {
                classe: "fila__vazia",
                texto: "Fila vazia. Quem chegar e couber senta direto."
            })
        ];
    }

    const nos: HTMLElement[] = [contador, desenharProximo(proximo, mesas, termo)];
    const tira = el("div", { classe: "fila__tira" });

    resto.slice(0, CARTOES_DEPOIS_DO_PROXIMO).forEach((item, indice) => {
        tira.append(desenharEspera(item, indice + 2, termo));
    });

    const sobram = resto.length - CARTOES_DEPOIS_DO_PROXIMO;
    if (sobram > 0) {
        tira.append(
            el(
                "div",
                { classe: "fila__sobra" },
                el("span", { classe: "mono fila__sobra-numero", texto: `+${sobram}` }),
                el("span", { texto: "esperando" })
            )
        );
    }

    nos.push(tira);
    return nos;
}
