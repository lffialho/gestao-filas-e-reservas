/**
 * CSV para abrir no Excel em português.
 *
 * Duas escolhas que decidem se o arquivo abre certo ou vira uma coluna só de
 * texto embaralhado:
 *
 * - **Ponto e vírgula**, não vírgula. No Windows em pt-BR o separador de lista
 *   é `;`, e um arquivo com vírgula cai todo na primeira coluna. Quem lê o
 *   arquivo com outra ferramenta escolhe o separador; quem lê com dois cliques
 *   no Excel, não.
 * - **BOM** no começo. Sem ele o Excel lê UTF-8 como Latin-1 e "Família Costa"
 *   vira "FamÃ­lia Costa".
 *
 * Nada disso é bonito. É o que faz o arquivo servir para quem vai abri-lo.
 *
 * O BOM é posto por `baixarCsv`, e não por `montarCsv`, porque é propriedade do
 * *arquivo* e não da tabela: um arquivo pode juntar duas tabelas, e um BOM no
 * meio dele não é marca de codificação — é lixo dentro de uma célula.
 */

const SEPARADOR = ";";
const BOM = "﻿";

export type Celula = string | number | null;

/**
 * Escapa uma célula conforme o RFC 4180: aspas dobradas, e o campo inteiro
 * entre aspas quando contém separador, aspas ou quebra de linha. Nome de
 * cliente digitado no balcão pode ter qualquer um dos três.
 */
function celula(valor: Celula): string {
    if (valor === null) {
        return "";
    }
    const texto = String(valor);
    if (!/[";\r\n]/u.test(texto)) {
        return texto;
    }
    return `"${texto.replace(/"/gu, '""')}"`;
}

/** Uma tabela em CSV. Sem BOM: juntar duas destas ainda tem de dar um arquivo. */
export function montarCsv(cabecalho: readonly string[], linhas: readonly (readonly Celula[])[]): string {
    const tudo = [cabecalho, ...linhas].map((linha) => linha.map(celula).join(SEPARADOR));
    // CRLF, também do RFC — e o que o Excel no Windows espera. A última linha
    // também termina em CRLF: arquivo sem terminador final confunde leitor.
    return `${tudo.join("\r\n")}\r\n`;
}

/**
 * Entrega o arquivo ao navegador, com o BOM na frente — uma vez só, no começo.
 * O blob é revogado depois: sem isso, cada download deixaria o conteúdo preso
 * na memória da aba até recarregar.
 */
export function baixarCsv(nomeDoArquivo: string, conteudo: string): void {
    const blob = new Blob([BOM + conteudo], { type: "text/csv;charset=utf-8" });
    const endereco = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = endereco;
    link.download = nomeDoArquivo;
    link.click();

    URL.revokeObjectURL(endereco);
}
