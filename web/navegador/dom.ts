/**
 * Montagem de DOM sem `innerHTML`.
 *
 * Nome de cliente é texto que alguém digitou no balcão. Se entrasse por
 * `innerHTML`, um `<img onerror=…>` digitado no lugar do nome viraria script
 * rodando na mesma página que fala com a API autenticada. Aqui todo texto entra
 * por `textContent`, e nada que venha do serviço vira marcação.
 */

export type Filho = Node | string | number | null | false;

export interface Opcoes {
    classe?: string;
    texto?: string | number;
    /** Vai para `dataset`: use camelCase, sai como `data-kebab-case`. */
    dados?: Record<string, string>;
    estilo?: Record<string, string>;
    atributos?: Record<string, string>;
}

function normalizar(filhos: readonly Filho[]): (Node | string)[] {
    const uteis: (Node | string)[] = [];
    for (const filho of filhos) {
        if (filho === null || filho === false) {
            continue;
        }
        uteis.push(typeof filho === "object" ? filho : String(filho));
    }
    return uteis;
}

export function el<K extends keyof HTMLElementTagNameMap>(
    nome: K,
    opcoes: Opcoes = {},
    ...filhos: readonly Filho[]
): HTMLElementTagNameMap[K] {
    const no = document.createElement(nome);

    if (opcoes.classe !== undefined) {
        no.className = opcoes.classe;
    }
    if (opcoes.texto !== undefined) {
        no.textContent = String(opcoes.texto);
    }
    for (const [chave, valor] of Object.entries(opcoes.dados ?? {})) {
        no.dataset[chave] = valor;
    }
    for (const [chave, valor] of Object.entries(opcoes.estilo ?? {})) {
        no.style.setProperty(chave, valor);
    }
    for (const [chave, valor] of Object.entries(opcoes.atributos ?? {})) {
        no.setAttribute(chave, valor);
    }

    no.append(...normalizar(filhos));
    return no;
}

/** Troca o conteúdo de uma região inteira de uma vez. */
export function trocar(alvo: Element, ...filhos: readonly Filho[]): void {
    alvo.replaceChildren(...normalizar(filhos));
}

/**
 * Elemento que o HTML promete ter. Sumir é erro de montagem da página, não
 * caso de uso — por isso estoura em vez de devolver `null` para todo mundo
 * conferir.
 */
export function exigir<T extends Element = HTMLElement>(seletor: string): T {
    const no = document.querySelector<T>(seletor);
    if (no === null) {
        throw new Error(`O painel esperava encontrar "${seletor}" na página.`);
    }
    return no;
}
