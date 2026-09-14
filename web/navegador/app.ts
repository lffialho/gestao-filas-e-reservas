import { Painel } from "./painel.js";

/**
 * Ponto de entrada do painel.
 *
 * O único trecho que roda fora do painel é este. Se a montagem falhar não há
 * painel para mostrar o erro, e página em branco é a pior resposta possível
 * para quem está com o salão cheio na frente.
 */
try {
    void new Painel().iniciar();
} catch (erro) {
    const recado = `O painel não conseguiu iniciar: ${erro instanceof Error ? erro.message : String(erro)}`;
    const aviso = document.querySelector("#aviso");

    if (aviso instanceof HTMLElement) {
        aviso.textContent = recado;
        aviso.hidden = false;
    } else {
        document.body.textContent = recado;
    }
}
