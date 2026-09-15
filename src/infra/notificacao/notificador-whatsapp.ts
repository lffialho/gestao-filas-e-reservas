import type { AvisoDeMesaPronta, Notificador } from "../../dominio/portas/notificador.js";

/**
 * Avisa o cliente pelo WhatsApp, pela API oficial da Meta (Cloud API).
 *
 * **Por que template, e não uma mensagem comum.** A Meta só deixa mandar texto
 * livre para quem falou com você nas últimas 24 h. Fora dessa janela — que é o
 * caso aqui, porque quem entra na fila não mandou mensagem nenhuma — a única
 * forma é um *template* aprovado antes. Daí `template` em vez de `text`.
 *
 * **Por que a API oficial, e não uma biblioteca que automatiza o WhatsApp Web.**
 * As não oficiais (whatsapp-web.js, Baileys e parentes) violam os termos da
 * Meta, e o que se perde quando o número é banido é o WhatsApp do restaurante —
 * o número que os clientes já têm na agenda, com o histórico de conversas. Num
 * software que se vende para outras casas, apostar o telefone do cliente nisso
 * não é uma escolha que caiba a nós fazer por ele.
 *
 * Nada aqui depende de receber mensagem: só sai HTTPS. É o que torna isto
 * viável numa máquina de balcão atrás de NAT, sem endereço público — receber
 * exigiria um webhook que a Meta pudesse alcançar, e um PC de restaurante não
 * tem isso.
 */

export interface OpcoesDoWhatsApp {
    /** Token de acesso permanente do app da Meta. */
    token: string;
    /** Id do número de telefone remetente, no painel da Meta. Não é o número. */
    numeroRemetenteId: string;
    /** Nome do template aprovado. Recebe o número da mesa como único parâmetro. */
    template: string;
    /** Idioma do template, como cadastrado na Meta. */
    idioma: string;
    /** Versão da API. Presa de propósito: a Meta muda o formato entre versões. */
    versao?: string | undefined;
    /** Quanto esperar pela Meta. O salão não pode travar esperando a rede. */
    tempoLimiteEmMs?: number | undefined;
    /** Só para teste: quem realmente faz o pedido. */
    buscar?: typeof fetch | undefined;
}

export class EnvioDeWhatsAppFalhou extends Error {
    readonly status: number;
    readonly detalhe: string;

    constructor(status: number, detalhe: string) {
        super(`O WhatsApp recusou o envio (HTTP ${status}): ${detalhe}`);
        this.name = "EnvioDeWhatsAppFalhou";
        this.status = status;
        this.detalhe = detalhe;
    }
}

/**
 * A Meta quer o telefone em E.164 **sem o `+`**, só dígitos. Aqui o telefone é
 * guardado com o `+`, e mandar como está faz a Meta aceitar o pedido e não
 * entregar a ninguém — falha silenciosa, que é a pior.
 */
export function paraFormatoDaMeta(telefone: string): string {
    return telefone.replace(/\D/gu, "");
}

export class NotificadorWhatsApp implements Notificador {
    readonly #opcoes: OpcoesDoWhatsApp;
    readonly #buscar: typeof fetch;

    constructor(opcoes: OpcoesDoWhatsApp) {
        this.#opcoes = opcoes;
        this.#buscar = opcoes.buscar ?? fetch;
    }

    async mesaPronta(aviso: AvisoDeMesaPronta): Promise<void> {
        const versao = this.#opcoes.versao ?? "v21.0";
        const url = `https://graph.facebook.com/${versao}/${this.#opcoes.numeroRemetenteId}/messages`;

        const corpo = {
            messaging_product: "whatsapp",
            to: paraFormatoDaMeta(aviso.telefone),
            type: "template",
            template: {
                name: this.#opcoes.template,
                language: { code: this.#opcoes.idioma },
                components: [
                    {
                        type: "body",
                        parameters: [{ type: "text", text: String(aviso.mesaNumero) }]
                    }
                ]
            }
        };

        // Prazo próprio: sem ele, uma Meta lenta seguraria a transação de quem
        // acabou de liberar a mesa, e o maître ficaria olhando a tela parada.
        const desistir = AbortSignal.timeout(this.#opcoes.tempoLimiteEmMs ?? 8000);

        const resposta = await this.#buscar(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.#opcoes.token}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(corpo),
            signal: desistir
        });

        if (!resposta.ok) {
            // O corpo do erro da Meta é onde está o motivo de verdade — template
            // não aprovado, número fora da lista, token vencido. Sem ele, o log
            // diria só "400" e ninguém saberia o que corrigir.
            const detalhe = await resposta.text().catch(() => "(sem corpo)");
            throw new EnvioDeWhatsAppFalhou(resposta.status, detalhe.slice(0, 500));
        }
    }
}
