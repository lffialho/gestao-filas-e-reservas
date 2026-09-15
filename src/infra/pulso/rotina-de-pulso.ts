import { type Relogio, relogioDoSistema } from "../../compartilhado/tempo/relogio.js";
import {
    descreverErro,
    registradorSilencioso,
    type Registrador
} from "../../compartilhado/log/registrador.js";

/**
 * "Sistema online": a casa avisa, de tempos em tempos, que está funcionando.
 *
 * Serve a quem **vende** o salão, não a quem opera. O salão já se levanta
 * sozinho quando cai; o que falta é alguém saber que a casa X está quieta desde
 * ontem sem esperar o telefone tocar no sábado.
 *
 * **O pulso sai, nada entra.** Perguntar de fora exigiria que cada balcão
 * tivesse endereço alcançável, o que um PC atrás de NAT não tem. Mandar de
 * dentro é só HTTPS de saída, que funciona em qualquer casa com internet.
 *
 * Quem recebe fica de fora de propósito: um serviço de monitoramento pronto —
 * dos que alertam quando o sinal **para** de chegar — resolve sem escrever
 * servidor nenhum. Trocar o destino é trocar uma variável.
 *
 * **Nenhum dado de cliente atravessa.** Nome, telefone e o diário ficam na
 * casa; daqui saem contagens e horários, e mais nada. Isso não é detalhe de
 * implementação: é o que permite apontar o pulso para um serviço de terceiro
 * sem mandar para fora dado pessoal de quem jantou ali.
 */

export interface OpcoesDoPulso {
    /** Para onde mandar. Sem isto não há pulso. */
    url: string;
    /** De quantos em quantos minutos. */
    aCadaMinutos: number;
    /** Qual casa é esta, para quem recebe distinguir. */
    casa?: string | undefined;
    /** O que contar junto, sempre sem dado pessoal. */
    resumo?: (() => Record<string, unknown>) | undefined;
    tempoLimiteEmMs?: number | undefined;
    registrador?: Registrador | undefined;
    relogio?: Relogio | undefined;
    buscar?: typeof fetch | undefined;
}

export interface EstadoDoPulso {
    ultimoEnvioEm: string | null;
    ultimaFalha: string | null;
    falhasSeguidas: number;
}

export class RotinaDePulso {
    readonly #opcoes: OpcoesDoPulso;
    readonly #registrador: Registrador;
    readonly #relogio: Relogio;
    readonly #buscar: typeof fetch;
    #agendado: ReturnType<typeof setInterval> | null = null;

    #ultimoEnvioEm: string | null = null;
    #ultimaFalha: string | null = null;
    #falhasSeguidas = 0;

    constructor(opcoes: OpcoesDoPulso) {
        this.#opcoes = opcoes;
        this.#registrador = opcoes.registrador ?? registradorSilencioso;
        this.#relogio = opcoes.relogio ?? relogioDoSistema;
        this.#buscar = opcoes.buscar ?? fetch;
    }

    estado(): EstadoDoPulso {
        return {
            ultimoEnvioEm: this.#ultimoEnvioEm,
            ultimaFalha: this.#ultimaFalha,
            falhasSeguidas: this.#falhasSeguidas
        };
    }

    /**
     * Manda o primeiro e agenda os próximos. O primeiro sai na subida porque é
     * ele que fecha o alerta aberto pela queda anterior — quem monitora precisa
     * saber que voltou, não só que caiu.
     */
    iniciar(): void {
        void this.agora();

        this.#agendado = setInterval(() => void this.agora(), this.#opcoes.aCadaMinutos * 60 * 1000);
        // Não segura o processo de pé só por causa do pulso.
        this.#agendado.unref();
    }

    parar(): void {
        if (this.#agendado !== null) {
            clearInterval(this.#agendado);
            this.#agendado = null;
        }
    }

    /**
     * Um pulso, agora. Nunca lança: monitoramento que derruba o salão troca um
     * risco pequeno por um grande. Internet fora é falha de pulso, não de
     * atendimento — e o restaurante continua sentando gente.
     */
    async agora(): Promise<boolean> {
        const instante = this.#relogio.agora();

        try {
            const resposta = await this.#buscar(this.#opcoes.url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    casa: this.#opcoes.casa ?? null,
                    momento: instante.toISOString(),
                    ...(this.#opcoes.resumo?.() ?? {})
                }),
                // Sem prazo, uma rede ruim deixaria pulsos empilhados para sempre.
                signal: AbortSignal.timeout(this.#opcoes.tempoLimiteEmMs ?? 10_000)
            });

            if (!resposta.ok) {
                throw new Error(`o destino respondeu ${resposta.status}`);
            }

            this.#ultimoEnvioEm = instante.toISOString();
            this.#ultimaFalha = null;
            this.#falhasSeguidas = 0;
            return true;
        } catch (erro) {
            const descricao = descreverErro(erro);
            this.#ultimaFalha = String(descricao.mensagem ?? erro);
            this.#falhasSeguidas += 1;

            // Aviso, e não erro: quem depende do pulso é quem monitora, e o
            // silêncio já é o alarme dele. Encher o log da casa não ajuda.
            this.#registrador.aviso("pulso_falhou", {
                falhasSeguidas: this.#falhasSeguidas,
                ...descricao
            });
            return false;
        }
    }
}
