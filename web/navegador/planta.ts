import type { InfoMesa, StatusMesa } from "./api.js";
import { casa } from "./busca.js";
import { el } from "./dom.js";
import { marcarRelogio } from "./relogios.js";

/**
 * A planta do salão desenhada.
 *
 * A grade é a mesma do domínio (12 × 9 ladrilhos); o que é decidido aqui é o
 * *vão* de cada mesa — quantos ladrilhos ela cobre — porque isso é questão de
 * caber na tela e de dar para contar as cadeiras de relance, não de negócio.
 *
 * Tudo em porcentagem da própria planta: o painel roda em monitor de escritório
 * e em tablet de balcão, e a disposição tem de ser a mesma nos dois.
 */
export const COLUNAS = 12;
export const LINHAS = 9;

interface Vao {
    colunas: number;
    linhas: number;
}

interface Lugar {
    coluna: number;
    linha: number;
    vao: Vao;
}

function vaoDa(capacidade: number): Vao {
    if (capacidade <= 2) {
        return { colunas: 2, linhas: 2 };
    }
    if (capacidade <= 4) {
        return { colunas: 3, linhas: 2 };
    }
    if (capacidade <= 6) {
        return { colunas: 3, linhas: 3 };
    }
    return { colunas: 4, linhas: 3 };
}

/** Que ladrilhos já estão sob alguma mesa. */
type Grade = boolean[][];

function gradeVazia(): Grade {
    return Array.from({ length: LINHAS }, () => new Array<boolean>(COLUNAS).fill(false));
}

function marcar(grade: Grade, { coluna, linha, vao }: Lugar): void {
    for (let l = linha; l < linha + vao.linhas; l++) {
        const faixa = grade[l];
        if (faixa === undefined) {
            continue;
        }
        for (let c = coluna; c < coluna + vao.colunas; c++) {
            faixa[c] = true;
        }
    }
}

function cabe(grade: Grade, coluna: number, linha: number, vao: Vao): boolean {
    if (coluna + vao.colunas > COLUNAS || linha + vao.linhas > LINHAS) {
        return false;
    }
    for (let l = linha; l < linha + vao.linhas; l++) {
        const faixa = grade[l];
        if (faixa === undefined) {
            return false;
        }
        for (let c = coluna; c < coluna + vao.colunas; c++) {
            if (faixa[c] === true) {
                return false;
            }
        }
    }
    return true;
}

/** Varre em ordem de leitura. Planta cheia empilha no canto — feio, mas visível. */
function primeiroVaoLivre(grade: Grade, vao: Vao): Lugar {
    for (let linha = 0; linha + vao.linhas <= LINHAS; linha++) {
        for (let coluna = 0; coluna + vao.colunas <= COLUNAS; coluna++) {
            if (cabe(grade, coluna, linha, vao)) {
                return { coluna, linha, vao };
            }
        }
    }
    return { coluna: 0, linha: 0, vao };
}

/** O lugar que a mesa pede, recuado para dentro quando o vão passaria da borda. */
function lugarPedido(mesa: InfoMesa): Lugar | null {
    const posicao = mesa.posicao;
    if (posicao === null) {
        return null;
    }
    const vao = vaoDa(mesa.capacidade);
    return {
        coluna: Math.min(Math.max(0, posicao.coluna), COLUNAS - vao.colunas),
        linha: Math.min(Math.max(0, posicao.linha), LINHAS - vao.linhas),
        vao
    };
}

/**
 * Onde cada mesa fica na tela.
 *
 * A posição do domínio é **um ladrilho**: o canto superior esquerdo. O vão de
 * vários ladrilhos é invenção desta tela, e daí vem o único caso interessante —
 * duas mesas a um ladrilho de distância são perfeitamente legais no domínio e
 * se cobririam aqui. Quando isso acontece, a de número menor fica onde está e a
 * outra vai para o primeiro vão livre: mesa desenhada em outro canto ainda se
 * lê, duas mesas empilhadas não se leem nenhuma.
 *
 * Daí os dois passes: primeiro quem tem posição e cabe nela, depois todo o
 * resto. Tudo em ordem de número, e não de chegada, para que a planta não dance
 * a cada atualização.
 */
export function distribuir(mesas: readonly InfoMesa[]): Map<string, Lugar> {
    const grade = gradeVazia();
    const lugares = new Map<string, Lugar>();
    const emOrdem = [...mesas].sort((a, b) => a.numero - b.numero);

    for (const mesa of emOrdem) {
        const pedido = lugarPedido(mesa);
        if (pedido === null || !cabe(grade, pedido.coluna, pedido.linha, pedido.vao)) {
            continue; // cai no passe seguinte, como se não tivesse posição
        }
        lugares.set(mesa.id, pedido);
        marcar(grade, pedido);
    }

    for (const mesa of emOrdem) {
        if (lugares.has(mesa.id)) {
            continue;
        }
        const escolhido = primeiroVaoLivre(grade, vaoDa(mesa.capacidade));
        lugares.set(mesa.id, escolhido);
        marcar(grade, escolhido);
    }

    return lugares;
}

const CLASSE_DO_STATUS: Record<StatusMesa, string> = {
    DISPONIVEL: "mesa--livre",
    RESERVADA: "mesa--chamada",
    OCUPADA: "mesa--ocupada"
};

function classeDoLugar(status: StatusMesa, tomado: boolean): string {
    if (status === "DISPONIVEL") {
        return "livre";
    }
    if (!tomado) {
        return "vago";
    }
    return status === "OCUPADA" ? "ocupado" : "reservado";
}

/**
 * Os lugares da mesa, metade de cada lado — é o que deixa contar as cadeiras
 * de longe e ver que sobram duas na mesa de quatro.
 */
function fileiraDeLugares(mesa: InfoMesa, lado: "cima" | "baixo"): HTMLElement {
    const emCima = Math.ceil(mesa.capacidade / 2);
    const quantos = lado === "cima" ? emCima : mesa.capacidade - emCima;
    const sentados = mesa.cliente?.quantidadePessoas ?? 0;
    const jaContados = lado === "cima" ? 0 : emCima;

    const fileira = el("span", { classe: "mesa__lugares" });
    for (let i = 0; i < quantos; i++) {
        fileira.append(
            el("span", { classe: `lugar ${classeDoLugar(mesa.status, jaContados + i < sentados)}` })
        );
    }
    return fileira;
}

/** A segunda linha do cartão: o que a mesa está fazendo, em uma frase curta. */
function legendaDa(mesa: InfoMesa): HTMLElement {
    const relogio = el("span", { classe: "mesa__relogio mono" });

    if (mesa.status === "RESERVADA") {
        return marcarRelogio(relogio, "prazo", mesa.desde);
    }
    if (mesa.status === "OCUPADA") {
        return marcarRelogio(relogio, "ocupada", mesa.desde);
    }
    return marcarRelogio(relogio, "livre", mesa.desde);
}

function desenharMesa(mesa: InfoMesa, lugar: Lugar, termo: string): HTMLElement {
    const nome = mesa.cliente?.nome ?? null;
    const achada = casa(termo, nome, mesa.cliente?.telefone ?? null);

    // Mesa livre mostra a capacidade no lugar do nome: numa mesa de dois o
    // cartão é estreito, e "2 lug." cabe onde "livre · 2 lug." era cortado.
    const cabeca = el(
        "span",
        { classe: "mesa__cabeca" },
        el("span", { classe: "mesa__numero mono", texto: String(mesa.numero).padStart(2, "0") }),
        el("span", { classe: "mesa__nome", texto: nome ?? `${mesa.capacidade} lug.` })
    );

    const corpo = el("span", { classe: "mesa__corpo" }, cabeca, legendaDa(mesa));
    if (mesa.status === "RESERVADA") {
        corpo.append(el("span", { classe: "mesa__barra" }));
    }

    const classes = ["mesa", CLASSE_DO_STATUS[mesa.status]];
    if (termo !== "") {
        classes.push(achada ? "achada" : "apagada");
    }

    const descricao = `Mesa ${mesa.numero}, ${mesa.capacidade} lugares, ${nome ?? "livre"}`;

    return el(
        "button",
        {
            classe: classes.join(" "),
            dados: { mesa: mesa.id },
            atributos: { type: "button", "aria-label": descricao },
            estilo: {
                left: `${(lugar.coluna / COLUNAS) * 100}%`,
                top: `${(lugar.linha / LINHAS) * 100}%`,
                width: `${(lugar.vao.colunas / COLUNAS) * 100}%`,
                height: `${(lugar.vao.linhas / LINHAS) * 100}%`
            }
        },
        fileiraDeLugares(mesa, "cima"),
        corpo,
        fileiraDeLugares(mesa, "baixo")
    );
}

/** A planta inteira. Salão sem mesa nenhuma diz isso em vez de ficar em branco. */
export function desenharPlanta(mesas: readonly InfoMesa[], termo: string): HTMLElement[] {
    if (mesas.length === 0) {
        return [
            el("p", {
                classe: "planta__vazia",
                texto: "Nenhuma mesa cadastrada ainda. Cadastre as mesas do salão para vê-las aqui."
            })
        ];
    }

    const lugares = distribuir(mesas);
    const nos: HTMLElement[] = [el("span", { classe: "planta__entrada", texto: "entrada" })];

    for (const mesa of [...mesas].sort((a, b) => a.numero - b.numero)) {
        const lugar = lugares.get(mesa.id);
        if (lugar === undefined) {
            continue;
        }
        nos.push(desenharMesa(mesa, lugar, termo));
    }

    return nos;
}
