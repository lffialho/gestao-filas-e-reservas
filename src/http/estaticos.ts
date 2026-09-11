import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

const TIPOS: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon"
};

/**
 * Serve os arquivos da interface. Fica fora do roteador da API de propósito:
 * é um recurso de outra natureza, não precisa de token e não passa pelo
 * tratamento de erro de domínio.
 *
 * A raiz é resolvida uma vez e todo caminho pedido é conferido contra ela.
 * Sem isso, `GET /../../.env` leria qualquer arquivo do disco — a falha
 * clássica de quem serve estático na mão.
 */
export class ServidorDeEstaticos {
    #raiz: string;

    constructor(raiz: string) {
        this.#raiz = resolve(raiz);
    }

    #resolverDentroDaRaiz(caminhoPedido: string): string | null {
        const relativo = normalize(decodeURIComponent(caminhoPedido)).replace(/^[/\\]+/, "");
        const absoluto = resolve(join(this.#raiz, relativo === "" ? "index.html" : relativo));

        if (absoluto !== this.#raiz && !absoluto.startsWith(this.#raiz + sep)) {
            return null;
        }
        return absoluto;
    }

    /** Responde o arquivo e devolve `true`; `false` quando não há o que servir. */
    async tentarServir(
        requisicao: IncomingMessage,
        resposta: ServerResponse,
        caminho: string
    ): Promise<boolean> {
        const metodo = requisicao.method ?? "GET";
        if (metodo !== "GET" && metodo !== "HEAD") {
            return false;
        }

        const absoluto = this.#resolverDentroDaRaiz(caminho);
        if (absoluto === null) {
            return false;
        }

        try {
            const info = await stat(absoluto);
            if (!info.isFile()) {
                return false;
            }

            resposta.writeHead(200, {
                "Content-Type": TIPOS[extname(absoluto).toLowerCase()] ?? "application/octet-stream",
                "Content-Length": info.size,
                // A simulação é local e muda a cada edição: não vale cachear.
                "Cache-Control": "no-store"
            });

            if (metodo === "HEAD") {
                resposta.end();
                return true;
            }

            await new Promise<void>((resolver, rejeitar) => {
                const fluxo = createReadStream(absoluto);
                fluxo.on("error", rejeitar);
                fluxo.on("end", resolver);
                fluxo.pipe(resposta);
            });
            return true;
        } catch {
            return false;
        }
    }
}
