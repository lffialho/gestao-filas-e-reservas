/**
 * A tela de entrada do painel.
 *
 * O HTML vem daqui, inteiro, e não de `publico/`: nada de `publico/` é servido
 * antes de autenticar, e uma tela de login que depende de arquivos protegidos
 * não abre. Sem CSS externo, sem fonte externa, sem script — o que evita
 * também que um erro futuro em `publico/` derrube a única porta de entrada.
 */

function escapar(texto: string): string {
    return texto
        .replace(/&/gu, "&amp;")
        .replace(/</gu, "&lt;")
        .replace(/>/gu, "&gt;")
        .replace(/"/gu, "&quot;");
}

export function paginaDeEntrada(recado: string | null): string {
    // O recado é sempre nosso, mas passa pelo escape do mesmo jeito: é a regra
    // da casa que nada entra em HTML sem escapar, e exceção vira esquecimento.
    const aviso = recado === null ? "" : `<p class="erro" role="alert">${escapar(recado)}</p>`;

    return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entrar · Salão</title>
<style>
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
  label { display: block; margin-bottom: 8px; font-size: 12px; letter-spacing: .08em;
          text-transform: uppercase; color: #8b949e; }
  input {
    width: 100%; padding: 14px 16px; font-size: 16px; color: inherit;
    background: #161b22; border: 1px solid #30363d; border-radius: 10px;
  }
  input:focus { outline: none; border-color: #3fb950; }
  button {
    width: 100%; margin-top: 16px; padding: 14px; font-size: 16px; font-weight: 600;
    color: #04260f; background: #3fb950; border: 0; border-radius: 10px; cursor: pointer;
  }
  button:hover { background: #56d364; }
  .erro {
    margin: 0 0 20px; padding: 12px 14px; border-radius: 10px; font-size: 14px;
    color: #ffa198; background: #2d1214; border: 1px solid #6e2c30;
  }
</style>
</head>
<body>
<main>
  <h1>SALÃO</h1>
  <p class="sub">Painel do maître</p>
  ${aviso}
  <form method="post" action="/entrar">
    <label for="senha">Senha do painel</label>
    <input id="senha" name="senha" type="password" autocomplete="current-password"
           autofocus required>
    <button type="submit">Entrar</button>
  </form>
</main>
</body>
</html>
`;
}
