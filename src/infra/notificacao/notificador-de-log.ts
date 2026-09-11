import type { Registrador } from "../../compartilhado/log/registrador.js";
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
        this.#registrador.info("aviso_mesa_pronta", {
            cliente: aviso.nome,
            telefone: aviso.telefone,
            mesaId: aviso.mesaId,
            mesaNumero: aviso.mesaNumero
        });
    }
}
