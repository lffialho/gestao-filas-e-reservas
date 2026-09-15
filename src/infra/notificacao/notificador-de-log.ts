import type { Registrador } from "../../compartilhado/log/registrador.js";
import { mascararNome, mascararTelefone } from "../../compartilhado/log/mascarar.js";
import type { AvisoDeMesaPronta, Notificador } from "../../dominio/portas/notificador.js";

/**
 * Registra o aviso no log em vez de enviar mensagem.
 *
 * É a emenda para SMS ou WhatsApp, não a integração: quem for ligar um
 * provedor de verdade implementa `Notificador` e entrega no lugar deste, sem
 * tocar no domínio. Até lá, o aviso fica visível na operação.
 */
export class NotificadorDeLog implements Notificador {
    #registrador: Registrador;

    constructor(registrador: Registrador) {
        this.#registrador = registrador;
    }

    async mesaPronta(aviso: AvisoDeMesaPronta): Promise<void> {
        // Mascarado porque o log vai para quem dá suporte, que é um terceiro
        // em relação a quem jantou aqui. Quem precisa do nome inteiro para
        // chamar o cliente é o maître, e ele olha o painel, não o log.
        this.#registrador.info("aviso_mesa_pronta", {
            cliente: mascararNome(aviso.nome),
            telefone: mascararTelefone(aviso.telefone),
            mesaId: aviso.mesaId,
            mesaNumero: aviso.mesaNumero
        });
    }
}
