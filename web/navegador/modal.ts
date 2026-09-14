import { el, trocar } from "./dom.js";

/**
 * A janela de ação do painel.
 *
 * Fica fora de tudo que a atualização automática substitui. O painel se
 * redesenha a cada poucos segundos, e uma janela que fechasse sozinha no meio
 * de uma decisão — ou um campo que perdesse o que estava sendo digitado — seria
 * pior do que não ter janela nenhuma.
 *
 * O que ela mostra é um retrato do instante em que abriu. Se o salão mudar por
 * baixo, quem recusa é o serviço, e a mensagem do erro aparece aqui: é o mesmo
 * contrato que qualquer outro cliente da API tem, e não uma regra paralela
 * inventada na tela.
 */

export interface Acao {
    rotulo: string;
    /** Pede uma segunda confirmação. Para o que tira a mesa de alguém. */
    confirmar: boolean;
    tom: "principal" | "perigo";
    /**
     * Faz a coisa e devolve a frase a mostrar. Frase vazia fecha a janela na
     * hora — é o certo para a ação rotineira, que não precisa de recibo.
     */
    executar(): Promise<string>;
}

export interface Conteudo {
    titulo: string;
    nota: string;
    acoes: readonly Acao[];
    /** Corpo extra: um formulário, uma tabela de fechamento, o que for. */
    corpo?: HTMLElement;
}

export class Modal {
    readonly #raiz: HTMLElement;
    readonly #depoisDeAgir: () => void;
    #devolverFoco: HTMLElement | null = null;
    #agindo = false;

    constructor(raiz: HTMLElement, depoisDeAgir: () => void) {
        this.#raiz = raiz;
        this.#depoisDeAgir = depoisDeAgir;

        // Clique no fundo fecha; clique dentro da caixa não sobe até aqui.
        this.#raiz.addEventListener("click", (evento) => {
            if (evento.target === this.#raiz) {
                this.fechar();
            }
        });

        // Enter num campo faz a ação principal. Quem digita um nome no balcão
        // termina apertando Enter, e não procurando o botão com o dedo.
        this.#raiz.addEventListener("keydown", (evento) => {
            if (evento.key !== "Enter" || !(evento.target instanceof HTMLInputElement)) {
                return;
            }
            evento.preventDefault();
            this.#raiz.querySelector<HTMLButtonElement>(".acao--principal")?.click();
        });
    }

    get aberto(): boolean {
        return !this.#raiz.hidden;
    }

    abrir(conteudo: Conteudo): void {
        const recado = el("p", { classe: "modal__recado" });
        recado.hidden = true;

        const acoes = el("div", { classe: "modal__acoes" });
        for (const acao of conteudo.acoes) {
            acoes.append(this.#botaoDe(acao, recado, acoes));
        }

        const fechar = el("button", {
            classe: "acao acao--discreta",
            texto: conteudo.acoes.length === 0 ? "Fechar" : "Cancelar",
            atributos: { type: "button" }
        });
        fechar.addEventListener("click", () => this.fechar());
        acoes.append(fechar);

        const caixa = el(
            "div",
            { classe: "modal__caixa", atributos: { role: "dialog", "aria-modal": "true" } },
            el("h2", { classe: "modal__titulo", texto: conteudo.titulo }),
            el("p", { classe: "modal__nota", texto: conteudo.nota }),
            conteudo.corpo ?? false,
            recado,
            acoes
        );

        this.#devolverFoco = document.activeElement instanceof HTMLElement ? document.activeElement : null;

        trocar(this.#raiz, caixa);
        this.#raiz.hidden = false;
        caixa.querySelector<HTMLElement>("input, button")?.focus();
    }

    fechar(): void {
        this.#raiz.hidden = true;
        this.#raiz.replaceChildren();
        this.#devolverFoco?.focus();
        this.#devolverFoco = null;
    }

    #botaoDe(acao: Acao, recado: HTMLElement, acoes: HTMLElement): HTMLElement {
        const botao = el("button", {
            classe: `acao acao--${acao.tom}`,
            texto: acao.rotulo,
            atributos: { type: "button" }
        });

        let armado = !acao.confirmar;

        botao.addEventListener("click", () => {
            if (!armado) {
                armado = true;
                botao.textContent = `Confirmar: ${acao.rotulo.toLowerCase()}`;
                botao.classList.add("acao--armada");
                return;
            }
            void this.#executar(acao, botao, recado, acoes);
        });

        return botao;
    }

    async #executar(
        acao: Acao,
        botao: HTMLButtonElement,
        recado: HTMLElement,
        acoes: HTMLElement
    ): Promise<void> {
        if (this.#agindo) {
            return;
        }
        this.#agindo = true;
        this.#travar(acoes, true);

        try {
            const frase = await acao.executar();
            // A tela atrás da janela é atualizada em qualquer caso: deu certo,
            // o salão mudou; deu errado, provavelmente mudou também.
            this.#depoisDeAgir();

            if (frase === "") {
                this.fechar();
                return;
            }
            this.#concluir(frase, recado, acoes);
        } catch (erro) {
            recado.textContent = erro instanceof Error ? erro.message : "Falha inesperada.";
            recado.className = "modal__recado modal__recado--erro";
            recado.hidden = false;
            this.#depoisDeAgir();
            this.#travar(acoes, false);
            botao.textContent = acao.rotulo;
            botao.classList.remove("acao--armada");
        } finally {
            this.#agindo = false;
        }
    }

    #travar(acoes: HTMLElement, travado: boolean): void {
        for (const botao of acoes.querySelectorAll("button")) {
            botao.disabled = travado;
        }
    }

    #concluir(frase: string, recado: HTMLElement, acoes: HTMLElement): void {
        recado.textContent = frase;
        recado.className = "modal__recado modal__recado--feito";
        recado.hidden = false;

        const pronto = el("button", {
            classe: "acao acao--principal",
            texto: "Pronto",
            atributos: { type: "button" }
        });
        pronto.addEventListener("click", () => this.fechar());
        trocar(acoes, pronto);
        pronto.focus();
    }
}
