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
    /**
     * SID (HX...) de um template aprovado. Obrigatório no WhatsApp fora da
     * janela de 24h — ver o comentário da classe. O template precisa receber
     * {{1}} = nome do cliente e {{2}} = número da mesa.
     */
    templateSid?: string | undefined;
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
    /** Link da Twilio para a documentação do código, quando ela manda. */
    readonly maisInfo: string | null;

    constructor(mensagem: string, status: number, codigoDoProvedor: number | null, maisInfo?: string | null) {
        super(mensagem);
        this.name = "FalhaNoProvedor";
        this.status = status;
        this.codigoDoProvedor = codigoDoProvedor;
        this.maisInfo = maisInfo ?? null;
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
    more_info?: string;
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
 *
 * TEXTO LIVRE OU TEMPLATE. O WhatsApp só aceita texto livre como resposta,
 * dentro de 24h de uma mensagem do cliente. "Sua mesa está pronta" é iniciada
 * pela empresa, então em produção exige template aprovado — informe o
 * `templateSid` e o texto passa a vir do template, com nome e número da mesa
 * preenchendo {{1}} e {{2}}. Sem `templateSid` vai `Body`, que serve para SMS
 * e para testar no sandbox depois da adesão abrir a janela.
 */
export class NotificadorTwilio implements Notificador {
    #contaSid: string;
    #autorizacao: string;
    #remetente: string;
    #canal: CanalTwilio;
    #templateSid: string | null;
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
        this.#templateSid = opcoes.templateSid ?? null;
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
            From: remetente
        });

        if (this.#templateSid === null) {
            corpo.set("Body", this.#texto(aviso));
        } else {
            // Template não leva Body: o texto vem do que foi aprovado, e daqui
            // vão só os valores que preenchem os espaços dele.
            corpo.set("ContentSid", this.#templateSid);
            corpo.set("ContentVariables", JSON.stringify({ "1": aviso.nome, "2": String(aviso.mesaNumero) }));
        }

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
                dados.code ?? null,
                dados.more_info ?? null
            );
        }

        // Aceita a requisição e recusa a mensagem: 201 com error_code preenchido.
        if (dados.error_code !== undefined && dados.error_code !== null) {
            throw new FalhaNoProvedor(
                dados.error_message ?? `Provedor recusou a mensagem (${dados.error_code}).`,
                resposta.status,
                dados.error_code,
                dados.more_info ?? null
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
