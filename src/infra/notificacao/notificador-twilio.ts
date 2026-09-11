import type { Registrador } from "../../compartilhado/log/registrador.js";
import type { AvisoDeMesaPronta, Notificador } from "../../dominio/portas/notificador.js";
import { paraE164 } from "./telefone-e164.js";

/**
 * SMS e WhatsApp saem pelo mesmo recurso da Twilio — só o prefixo de `To` e
 * `From` muda. Por isso um adaptador só, com o canal em configuração.
 */
export type CanalTwilio = "sms" | "whatsapp";

export interface OpcoesDoNotificadorTwilio {
    contaSid: string;
    tokenDeAutenticacao: string;
    /** Número remetente. No sandbox de WhatsApp, o número da Twilio. */
    remetente: string;
    canal?: CanalTwilio | undefined;
    /** DDI assumido quando o telefone vem sem ele. 55 = Brasil. */
    paisPadrao?: string | undefined;
    /** Trocado nos testes por um servidor local. */
    urlBase?: string | undefined;
    tempoLimiteMs?: number | undefined;
    registrador?: Registrador | undefined;
}

/** Erro do provedor, com o código dele preservado para diagnóstico. */
export class FalhaNoProvedor extends Error {
    readonly status: number;
    readonly codigoDoProvedor: number | null;

    constructor(mensagem: string, status: number, codigoDoProvedor: number | null) {
        super(mensagem);
        this.name = "FalhaNoProvedor";
        this.status = status;
        this.codigoDoProvedor = codigoDoProvedor;
    }
}

interface RespostaDaTwilio {
    sid?: string;
    status?: string;
    /** Preenchido quando a Twilio aceita a requisição mas recusa a mensagem. */
    error_code?: number | null;
    error_message?: string | null;
    /** Erro em nível de HTTP vem nestes campos, não nos de cima. */
    code?: number;
    message?: string;
}

const URL_BASE_PADRAO = "https://api.twilio.com";
const TEMPO_LIMITE_PADRAO_MS = 10_000;

/**
 * Envia o aviso por SMS ou WhatsApp pela Twilio.
 *
 * O formato da requisição vem da documentação do recurso Message: POST
 * form-urlencoded para /2010-04-01/Accounts/{sid}/Messages.json, autenticado
 * por Basic, com To, From e Body.
 *
 * Duas formas de falha, tratadas separadamente porque a Twilio as reporta
 * diferente: erro de HTTP (4xx/5xx) traz `code` e `message`; requisição aceita
 * com mensagem recusada vem 201 e traz `error_code` e `error_message`.
 *
 * Há tempo limite: provedor pendurado não pode prender a operação do salão.
 */
export class NotificadorTwilio implements Notificador {
    #contaSid: string;
    #autorizacao: string;
    #remetente: string;
    #canal: CanalTwilio;
    #paisPadrao: string;
    #urlBase: string;
    #tempoLimiteMs: number;
    #registrador: Registrador | null;

    constructor(opcoes: OpcoesDoNotificadorTwilio) {
        if (opcoes.contaSid.trim() === "" || opcoes.tokenDeAutenticacao.trim() === "") {
            throw new Error("NotificadorTwilio exige contaSid e tokenDeAutenticacao.");
        }
        if (opcoes.remetente.trim() === "") {
            throw new Error("NotificadorTwilio exige um remetente.");
        }

        this.#contaSid = opcoes.contaSid;
        this.#autorizacao = Buffer.from(`${opcoes.contaSid}:${opcoes.tokenDeAutenticacao}`).toString(
            "base64"
        );
        this.#remetente = opcoes.remetente;
        this.#canal = opcoes.canal ?? "sms";
        this.#paisPadrao = opcoes.paisPadrao ?? "55";
        this.#urlBase = opcoes.urlBase ?? URL_BASE_PADRAO;
        this.#tempoLimiteMs = opcoes.tempoLimiteMs ?? TEMPO_LIMITE_PADRAO_MS;
        this.#registrador = opcoes.registrador ?? null;
    }

    /** WhatsApp exige o prefixo "whatsapp:" nos dois endereços. */
    #enderecar(numeroE164: string): string {
        return this.#canal === "whatsapp" ? `whatsapp:${numeroE164}` : numeroE164;
    }

    #texto(aviso: AvisoDeMesaPronta): string {
        return `Olá, ${aviso.nome}! Sua mesa ${aviso.mesaNumero} está pronta. Pode vir ao salão.`;
    }

    async mesaPronta(aviso: AvisoDeMesaPronta): Promise<void> {
        const destino = paraE164(aviso.telefone, this.#paisPadrao);
        const remetente = this.#remetente.startsWith("whatsapp:")
            ? this.#remetente
            : this.#enderecar(this.#remetente);

        const corpo = new URLSearchParams({
            To: this.#enderecar(destino),
            From: remetente,
            Body: this.#texto(aviso)
        });

        const url = `${this.#urlBase}/2010-04-01/Accounts/${this.#contaSid}/Messages.json`;

        const resposta = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Basic ${this.#autorizacao}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: corpo.toString(),
            signal: AbortSignal.timeout(this.#tempoLimiteMs)
        });

        const texto = await resposta.text();
        let dados: RespostaDaTwilio = {};
        try {
            dados = texto === "" ? {} : (JSON.parse(texto) as RespostaDaTwilio);
        } catch {
            // Resposta que não é JSON só importa se o status já indicou falha.
        }

        if (!resposta.ok) {
            throw new FalhaNoProvedor(
                dados.message ?? `Provedor respondeu ${resposta.status}.`,
                resposta.status,
                dados.code ?? null
            );
        }

        // Aceita a requisição e recusa a mensagem: 201 com error_code preenchido.
        if (dados.error_code !== undefined && dados.error_code !== null) {
            throw new FalhaNoProvedor(
                dados.error_message ?? `Provedor recusou a mensagem (${dados.error_code}).`,
                resposta.status,
                dados.error_code
            );
        }

        this.#registrador?.info("aviso_enviado", {
            canal: this.#canal,
            mesaId: aviso.mesaId,
            mensagemSid: dados.sid ?? null,
            situacao: dados.status ?? null
        });
    }
}
