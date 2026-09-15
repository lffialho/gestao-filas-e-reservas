import { MINIMO_DE_CARACTERES } from "./credencial.js";

/**
 * As telas de senha do painel.
 *
 * O HTML vem daqui, inteiro, e não de `publico/`: nada de `publico/` é servido
 * antes de autenticar, e uma tela de login que depende de arquivos protegidos
 * não abre. Sem CSS externo, sem fonte externa, sem script — o que evita também
 * que um erro futuro em `publico/` derrube a única porta de entrada.
 */

function escapar(texto: string): string {
    return texto
        .replace(/&/gu, "&amp;")
        .replace(/</gu, "&lt;")
        .replace(/>/gu, "&gt;")
        .replace(/"/gu, "&quot;");
}

const ESTILO = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #0d1117; color: #e6edf3; padding: 24px;
    font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  }
  main { width: 100%; max-width: 380px; }
  h1 { margin: 0 0 4px; font-size: 28px; letter-spacing: .06em; }
  p.sub { margin: 0 0 28px; color: #8b949e; font-size: 14px; }
  label { display: block; margin: 16px 0 8px; font-size: 12px; letter-spacing: .08em;
          text-transform: uppercase; color: #8b949e; }
  input {
    width: 100%; padding: 14px 16px; font-size: 16px; color: inherit;
    background: #161b22; border: 1px solid #30363d; border-radius: 10px;
  }
  input:focus { outline: none; border-color: #3fb950; }
  button {
    width: 100%; margin-top: 20px; padding: 14px; font-size: 16px; font-weight: 600;
    color: #04260f; background: #3fb950; border: 0; border-radius: 10px; cursor: pointer;
  }
  button:hover { background: #56d364; }
  .erro, .nota {
    margin: 0 0 20px; padding: 12px 14px; border-radius: 10px; font-size: 14px;
  }
  .erro { color: #ffa198; background: #2d1214; border: 1px solid #6e2c30; }
  .nota { color: #c9d1d9; background: #161b22; border: 1px solid #30363d; }
  .voltar { display: block; margin-top: 20px; font-size: 14px; color: #8b949e; text-align: center; }
`;

function pagina(titulo: string, miolo: string): string {
    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)} · Salão</title>
<style>${ESTILO}</style>
</head>
<body>
<main>
  <h1>SALÃO</h1>
  <p class="sub">Painel do maître</p>
  ${miolo}
</main>
</body>
</html>
`;
}

/**
 * O recado é sempre nosso, mas passa pelo escape do mesmo jeito: é a regra da
 * casa que nada entra em HTML sem escapar, e exceção vira esquecimento.
 */
function aviso(recado: string | null, classe: "erro" | "nota"): string {
    return recado === null ? "" : `<p class="${classe}" role="alert">${escapar(recado)}</p>`;
}

export function paginaDeEntrada(recado: string | null): string {
    return pagina(
        "Entrar",
        `${aviso(recado, "erro")}
  <form method="post" action="/entrar">
    <label for="senha">Senha do painel</label>
    <input id="senha" name="senha" type="password" autocomplete="current-password"
           autofocus required>
    <button type="submit">Entrar</button>
  </form>`
    );
}

/**
 * A primeira abertura. Quem opera define a senha aqui, e não num arquivo de
 * configuração: é uma etapa de instalação a menos para dar errado em silêncio,
 * e a senha passa a ser escolha de quem vai digitá-la todo dia.
 */
export function paginaDeCriarSenha(recado: string | null): string {
    return pagina(
        "Criar senha",
        `${aviso(recado, "erro")}
  ${aviso(
      "Primeira abertura: crie a senha do painel. Ela vale no computador do balcão e no tablet — " +
          "é a mesma senha nos dois.",
      "nota"
  )}
  <form method="post" action="/criar-senha">
    <label for="senha">Senha (mínimo ${MINIMO_DE_CARACTERES} caracteres)</label>
    <input id="senha" name="senha" type="password" autocomplete="new-password"
           minlength="${MINIMO_DE_CARACTERES}" autofocus required>
    <label for="repetida">Repita a senha</label>
    <input id="repetida" name="repetida" type="password" autocomplete="new-password"
           minlength="${MINIMO_DE_CARACTERES}" required>
    <button type="submit">Criar senha e entrar</button>
  </form>`
    );
}

export function paginaDeTrocarSenha(recado: string | null, deuCerto: boolean): string {
    return pagina(
        "Trocar senha",
        `${aviso(recado, deuCerto ? "nota" : "erro")}
  <form method="post" action="/trocar-senha">
    <label for="atual">Senha atual</label>
    <input id="atual" name="atual" type="password" autocomplete="current-password" autofocus required>
    <label for="senha">Nova senha (mínimo ${MINIMO_DE_CARACTERES} caracteres)</label>
    <input id="senha" name="senha" type="password" autocomplete="new-password"
           minlength="${MINIMO_DE_CARACTERES}" required>
    <label for="repetida">Repita a nova senha</label>
    <input id="repetida" name="repetida" type="password" autocomplete="new-password"
           minlength="${MINIMO_DE_CARACTERES}" required>
    <button type="submit">Trocar senha</button>
  </form>
  <a class="voltar" href="/">Voltar ao painel</a>`
    );
}
