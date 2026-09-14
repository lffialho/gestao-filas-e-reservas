import { el } from "./dom.js";

/**
 * O formulário de quem chegou.
 *
 * Três campos e nada mais: nome, quantas pessoas, telefone. O telefone é
 * obrigatório porque é por ele que o salão reconhece a pessoa — é a identidade
 * do cliente no domínio, não um detalhe de contato.
 *
 * Quem decide entre mesa e fila é o serviço, nunca esta tela: mandar a chegada
 * e ler o destino da resposta é o que garante que o painel e a regra de negócio
 * nunca discordem sobre quem sentou onde.
 */

export interface Chegada {
    nome: string;
    pessoas: number;
    telefone: string;
}

export interface FormularioDeChegada {
    corpo: HTMLElement;
    /** Lê o que está nos campos. Vazio ou inválido vira erro do serviço. */
    ler(): Chegada;
}

function campo(rotulo: string, entrada: HTMLInputElement): HTMLElement {
    const id = `campo-${entrada.name}`;
    entrada.id = id;
    return el(
        "label",
        { classe: "campo", atributos: { for: id } },
        el("span", { classe: "rotulo", texto: rotulo }),
        entrada
    );
}

function entrada(nome: string, tipo: string, atributos: Record<string, string>): HTMLInputElement {
    const no = el("input", { classe: "campo__entrada", atributos: { type: tipo, ...atributos } });
    no.name = nome;
    return no;
}

export function formularioDeChegada(): FormularioDeChegada {
    const nome = entrada("nome", "text", { autocomplete: "off", placeholder: "Marcos e amigos" });
    const pessoas = entrada("pessoas", "number", { min: "1", step: "1", value: "2" });
    const telefone = entrada("telefone", "tel", {
        autocomplete: "off",
        placeholder: "+55 11 99999-9999"
    });

    const corpo = el(
        "div",
        { classe: "formulario" },
        campo("Nome do grupo", nome),
        campo("Pessoas", pessoas),
        campo("Telefone", telefone)
    );

    return {
        corpo,
        ler: () => ({
            nome: nome.value.trim(),
            // Campo vazio dá NaN, que o serviço recusa com a mensagem certa —
            // melhor do que esta tela inventar um número.
            pessoas: Number.parseInt(pessoas.value, 10),
            telefone: telefone.value.trim()
        })
    };
}
