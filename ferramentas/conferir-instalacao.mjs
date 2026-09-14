import { readFileSync } from "node:fs";

/**
 * Confere uma instalação inteira, de fora, como um cliente faria.
 *
 * A suíte de `npm test` prova o domínio; isto prova a **instalação**: HTTP de
 * verdade, token de verdade, SQLite de verdade, painel de verdade, os dois
 * processos no ar. É o que se roda depois de instalar numa casa nova, antes de
 * entregar a chave — e o que se pede para rodar quando alguém liga dizendo que
 * "o painel não abre".
 *
 *   node ferramentas/conferir-instalacao.mjs --pode-escrever
 *
 * **Ele escreve no salão**: senta gente, põe na fila, cadastra e remove mesa.
 * Por isso só roda com `--pode-escrever` e só num salão em repouso — nenhuma
 * mesa ocupada, ninguém na fila. Num salão em serviço ele se recusa, porque
 * "teste que atrapalha o sábado" é pior do que teste nenhum.
 *
 * O que ele deixa para trás é diário: os eventos ficam, como ficariam de uma
 * noite de verdade. Para apagar, restaure a cópia anterior.
 */

const RAIZ = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, "$1");

const env = readFileSync(`${RAIZ}/.env`, "utf8");
const token = /^\s*SALAO_TOKEN\s*=\s*(.+)$/mu.exec(env)?.[1]?.trim().replace(/^"|"$/gu, "");
const API = process.env["SALAO_API"] ?? "http://127.0.0.1:3000";

let passou = 0;
let falhou = 0;
const falhas = [];

async function chamar(metodo, caminho, corpo, semToken = false) {
    const cabecalhos = semToken ? {} : { Authorization: `Bearer ${token}` };
    if (corpo !== undefined) cabecalhos["Content-Type"] = "application/json";
    const r = await fetch(`${API}${caminho}`, {
        method: metodo,
        headers: cabecalhos,
        body: corpo === undefined ? undefined : JSON.stringify(corpo)
    });
    const texto = await r.text();
    let dados = null;
    try {
        dados = texto === "" ? null : JSON.parse(texto);
    } catch {
        dados = texto;
    }
    return { status: r.status, dados };
}

function conferir(rotulo, condicao, detalhe = "") {
    if (condicao) {
        passou += 1;
        console.log(`  ok    ${rotulo}`);
    } else {
        falhou += 1;
        falhas.push(`${rotulo} ${detalhe}`);
        console.log(`  FALHA ${rotulo}  ${detalhe}`);
    }
}

function secao(titulo) {
    console.log(`\n=== ${titulo} ===`);
}

const DE = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
const ATE = new Date(Date.now() + 3600 * 1000).toISOString();

const tel = (n) => `+55119999900${String(n).padStart(2, "0")}`;

// ------------------------------------------------------------------- a trava
if (!process.argv.includes("--pode-escrever")) {
    console.error(
        [
            "Este teste escreve no salão: senta gente, põe na fila, cadastra e remove mesa.",
            "Rode com --pode-escrever, e só num salão em repouso.",
            "",
            "  node ferramentas/conferir-instalacao.mjs --pode-escrever"
        ].join("\n")
    );
    process.exit(2);
}

{
    const emRepouso = await chamar("GET", "/salao");
    if (emRepouso.status !== 200) {
        console.error(`O serviço não respondeu em ${API} (status ${emRepouso.status}). Ele está no ar?`);
        process.exit(2);
    }
    const ocupadas = emRepouso.dados.mesas.filter((m) => m.status !== "DISPONIVEL");
    const fila = await chamar("GET", "/fila");
    if (ocupadas.length > 0 || (fila.dados?.itens?.length ?? 0) > 0) {
        console.error(
            [
                `O salão está em serviço: ${ocupadas.length} mesa(s) em uso e ` +
                    `${fila.dados?.itens?.length ?? 0} na fila.`,
                "Este teste só roda com o salão em repouso — não dá para testar por cima de um atendimento."
            ].join("\n")
        );
        process.exit(2);
    }
}

// ------------------------------------------------------------------ saúde e auth
secao("saúde e autenticação");
{
    const saude = await chamar("GET", "/saude", undefined, true);
    conferir("/saude responde sem token", saude.status === 200, `status ${saude.status}`);

    const semToken = await chamar("GET", "/salao", undefined, true);
    conferir("/salao exige token (401)", semToken.status === 401, `status ${semToken.status}`);

    const comToken = await chamar("GET", "/salao");
    conferir("/salao com token (200)", comToken.status === 200, `status ${comToken.status}`);

    const metodoErrado = await chamar("PUT", "/salao");
    conferir("método não aceito (405)", metodoErrado.status === 405, `status ${metodoErrado.status}`);
}

// ------------------------------------------------------------------------ prévia
secao("prévia da chegada, sem efeito colateral");
{
    const antes = await chamar("GET", "/salao");
    const previa = await chamar("GET", "/chegadas/previa?pessoas=2");
    conferir("prévia responde 200", previa.status === 200, `status ${previa.status}`);
    const menorQueServe = [...antes.dados.mesas]
        .filter((m) => m.status === "DISPONIVEL" && m.capacidade >= 2)
        .sort((a, b) => a.capacidade - b.capacidade || a.numero - b.numero)[0];
    conferir(
        `prévia manda para a menor mesa que serve (n${menorQueServe?.numero})`,
        previa.dados?.mesa?.id === menorQueServe?.id,
        JSON.stringify(previa.dados)
    );
    const depois = await chamar("GET", "/salao");
    conferir(
        "prévia não mudou nada",
        JSON.stringify(antes.dados) === JSON.stringify(depois.dados),
        "o salão mudou depois de uma consulta de prévia"
    );
}

// ----------------------------------------------------------------- enchendo a casa
// Nada aqui assume quantas mesas a casa tem: o teste roda contra o salão que
// estiver instalado. Grupos de 2 sentam na menor mesa livre que os acomoda, um
// por vez, até a casa encher — e o primeiro que não couber prova a fila.
secao("enchendo o salão por ordem de chegada");
let primeiraMesa = null;
{
    const inicial = await chamar("GET", "/salao");
    const cabem = inicial.dados.mesas.filter((m) => m.capacidade >= 2 && m.status === "DISPONIVEL");
    conferir(
        "o salão começa vazio para o teste",
        cabem.length === inicial.dados.mesas.length,
        `${cabem.length} livres de ${inicial.dados.mesas.length}`
    );

    const capacidades = [...cabem].sort((a, b) => a.capacidade - b.capacidade || a.numero - b.numero);
    let sentaram = 0;

    for (let i = 0; i < capacidades.length; i += 1) {
        const r = await chamar("POST", "/chegadas", {
            nome: `Grupo ${i + 1}`,
            pessoas: 2,
            telefone: tel(i + 1)
        });
        const esperada = capacidades[i];
        const ok = r.status === 201 && r.dados?.destino === "mesa" && r.dados.mesa.id === esperada.id;
        if (i === 0 && r.dados?.mesa) primeiraMesa = r.dados.mesa.id;
        conferir(
            `grupo ${i + 1} senta na mesa ${esperada.numero} (a menor livre que serve)`,
            ok,
            `status ${r.status} destino ${r.dados?.destino} mesa ${r.dados?.mesa?.numero}`
        );
        if (ok) sentaram += 1;
    }

    const depois = await chamar("GET", "/salao");
    conferir(
        "a casa encheu",
        depois.dados.mesas.every((m) => m.status !== "DISPONIVEL"),
        depois.dados.mesas.map((m) => m.status).join(",")
    );
    conferir(
        "todos os grupos sentaram",
        sentaram === capacidades.length,
        `${sentaram}/${capacidades.length}`
    );
}

// ------------------------------------------------------------------------- a fila
secao("a fila, quando não há mesa");
{
    const f = await chamar("POST", "/chegadas", { nome: "Fabio", pessoas: 2, telefone: tel(90) });
    conferir(
        "com a casa cheia, Fabio vai para a fila",
        f.status === 201 && f.dados?.destino === "fila",
        JSON.stringify(f.dados)
    );

    const repetido = await chamar("POST", "/chegadas", {
        nome: "Fabio again",
        pessoas: 2,
        telefone: tel(90)
    });
    conferir(
        "mesmo telefone na fila é recusado (409)",
        repetido.status === 409 && repetido.dados?.erro?.tipo === "ClienteJaNaFila",
        `status ${repetido.status} tipo ${repetido.dados?.erro?.tipo}`
    );

    const jaSentado = await chamar("POST", "/chegadas", { nome: "Repetido", pessoas: 2, telefone: tel(1) });
    conferir(
        "telefone de quem já está sentado é recusado (409)",
        jaSentado.status === 409 && jaSentado.dados?.erro?.tipo === "ClienteJaNoSalao",
        `status ${jaSentado.status} tipo ${jaSentado.dados?.erro?.tipo}`
    );

    await chamar("POST", "/chegadas", { nome: "Gabi", pessoas: 2, telefone: tel(91) });
    const fila = await chamar("GET", "/fila");
    conferir(
        "a fila tem dois",
        fila.dados?.itens?.length === 2,
        `fila ${JSON.stringify(fila.dados?.itens?.map((i) => i.cliente.nome))}`
    );
    conferir(
        "Fabio é o primeiro",
        fila.dados?.itens?.[0]?.cliente?.nome === "Fabio",
        JSON.stringify(fila.dados?.itens?.[0])
    );

    const grande = await chamar("POST", "/chegadas", { nome: "Excursão", pessoas: 99, telefone: tel(92) });
    conferir(
        "grupo que nenhuma mesa serve é recusado (422)",
        grande.status === 422 && grande.dados?.erro?.tipo === "GrupoSemMesaPossivel",
        `status ${grande.status} tipo ${grande.dados?.erro?.tipo}`
    );
}

// --------------------------------------------- liberar mesa com gente esperando
secao("liberar mesa com alguém na fila");
{
    const liberou = await chamar("POST", `/mesas/${primeiraMesa}/liberacao`);
    conferir(
        "libera a primeira mesa (200)",
        liberou.status >= 200 && liberou.status < 300,
        `status ${liberou.status}`
    );

    const m1 = await chamar("GET", `/mesas/${primeiraMesa}`);
    conferir(
        "a mesa vaga nasce RESERVADA para quem esperava (fila ganha de mesa vazia)",
        m1.dados?.status === "RESERVADA",
        `status da mesa: ${m1.dados?.status}`
    );

    const naoSai = await chamar("DELETE", `/mesas/${primeiraMesa}`);
    conferir(
        "mesa já chamada não sai da planta (409)",
        naoSai.status === 409 && naoSai.dados?.erro?.tipo === "MesaEmUso",
        `status ${naoSai.status} tipo ${naoSai.dados?.erro?.tipo}`
    );

    const ocupou = await chamar("POST", `/mesas/${primeiraMesa}/ocupacao`);
    conferir(
        "senta quem foi chamado (200)",
        ocupou.status >= 200 && ocupou.status < 300,
        `status ${ocupou.status}`
    );

    const fila = await chamar("GET", "/fila");
    conferir("a fila baixou para um", fila.dados?.itens?.length === 1, `fila ${fila.dados?.itens?.length}`);
}

// ------------------------------------------------------------------- desistência
secao("desistência");
{
    const saiu = await chamar("DELETE", `/fila/${encodeURIComponent(tel(91))}`);
    conferir("Gabi desiste (200)", saiu.status >= 200 && saiu.status < 300, `status ${saiu.status}`);

    const fila = await chamar("GET", "/fila");
    conferir("a fila esvaziou", fila.dados?.itens?.length === 0, `fila ${fila.dados?.itens?.length}`);

    const denovo = await chamar("DELETE", `/fila/${encodeURIComponent(tel(91))}`);
    conferir(
        "quem não está na fila devolve 404",
        denovo.status === 404 && denovo.dados?.erro?.tipo === "ClienteNaoEstaNaFila",
        `status ${denovo.status} tipo ${denovo.dados?.erro?.tipo}`
    );
}

// ------------------------------------------------------------------ montar salão
secao("montar o salão");
{
    const nova = await chamar("POST", "/mesas", { id: "m9", numero: 9, capacidade: 8 });
    conferir("cadastra mesa nova (200)", nova.status >= 200 && nova.status < 300, `status ${nova.status}`);

    const duplicada = await chamar("POST", "/mesas", { id: "m10", numero: 9, capacidade: 4 });
    conferir(
        "número de mesa duplicado é recusado (409)",
        duplicada.status === 409 && duplicada.dados?.erro?.tipo === "NumeroDeMesaDuplicado",
        `status ${duplicada.status} tipo ${duplicada.dados?.erro?.tipo}`
    );

    const posicao = await chamar("POST", "/mesas/m9/posicao", { coluna: 3, linha: 2 });
    conferir(
        "move a mesa na planta (200)",
        posicao.status >= 200 && posicao.status < 300,
        `status ${posicao.status}`
    );

    const foraDaPlanta = await chamar("POST", "/mesas/m9/posicao", { coluna: 999, linha: 999 });
    conferir(
        "posição fora da planta é recusada (422)",
        foraDaPlanta.status === 422 && foraDaPlanta.dados?.erro?.tipo === "PosicaoForaDaPlanta",
        `status ${foraDaPlanta.status} tipo ${foraDaPlanta.dados?.erro?.tipo}`
    );

    const ocupada = await chamar("DELETE", `/mesas/${primeiraMesa}`);
    conferir(
        "mesa com gente não sai da planta (409)",
        ocupada.status === 409 && ocupada.dados?.erro?.tipo === "MesaEmUso",
        `status ${ocupada.status} tipo ${ocupada.dados?.erro?.tipo}`
    );

    const removeu = await chamar("DELETE", "/mesas/m9");
    conferir(
        "mesa livre sai da planta (200)",
        removeu.status >= 200 && removeu.status < 300,
        `status ${removeu.status}`
    );

    const sumiu = await chamar("GET", "/mesas/m9");
    conferir(
        "mesa removida devolve 404",
        sumiu.status === 404 && sumiu.dados?.erro?.tipo === "MesaNaoEncontrada",
        `status ${sumiu.status} tipo ${sumiu.dados?.erro?.tipo}`
    );
}

// ---------------------------------------------------------- relatório e diário
secao("relatório e diário");
{
    const rel = await chamar("GET", `/relatorio?de=${DE}&ate=${ATE}`);
    conferir("relatório responde 200", rel.status === 200, `status ${rel.status}`);

    const ev = await chamar("GET", `/eventos?de=${DE}&ate=${ATE}&limite=500`);
    conferir("diário responde 200", ev.status === 200, `status ${ev.status}`);
    const eventos = ev.dados?.itens ?? [];
    conferir("o diário registrou a noite", eventos.length > 0, `eventos ${eventos.length}`);

    const tipos = new Set(eventos.map((e) => e.tipo));
    conferir("registrou remoção de mesa", tipos.has("mesa_removida"), [...tipos].join(", "));

    const removidos = eventos.filter((e) => e.tipo === "mesa_removida");
    conferir(
        "evento de mesa removida guardou número e capacidade",
        removidos.length > 0 &&
            removidos.every((e) => typeof e.mesaNumero === "number" && typeof e.capacidade === "number"),
        JSON.stringify(removidos[0] ?? null)
    );

    const limiteRuim = await chamar("GET", `/eventos?de=${DE}&ate=${ATE}&limite=9999`);
    conferir(
        "limite fora do intervalo é recusado (400)",
        limiteRuim.status === 400,
        `status ${limiteRuim.status}`
    );
}

// ------------------------------------------------------------------------ painel
secao("o painel, e a senha dele");
{
    const senha = /^\s*PAINEL_SENHA\s*=\s*(.+)$/mu.exec(env)?.[1]?.trim().replace(/^"|"$/gu, "");
    const PAINEL = "http://localhost:5173";
    const semSeguir = { redirect: "manual" };

    // Sem sessão: nada sai, nem os estáticos.
    const raiz = await fetch(`${PAINEL}/`, semSeguir);
    conferir("painel sem senha redireciona para /entrar", raiz.status === 303, `status ${raiz.status}`);

    const estatico = await fetch(`${PAINEL}/estilo.css`, semSeguir);
    conferir("nem o CSS sai sem sessão", estatico.status === 303, `status ${estatico.status}`);

    const apiSemSessao = await fetch(`${PAINEL}/api/salao`, semSeguir);
    conferir("/api sem sessão devolve 401", apiSemSessao.status === 401, `status ${apiSemSessao.status}`);
    const corpo = await apiSemSessao.json().catch(() => null);
    conferir(
        "o 401 vem em JSON, para o painel saber pedir a senha",
        corpo?.erro?.tipo === "PainelNaoAutenticado",
        JSON.stringify(corpo)
    );

    const entrada = await fetch(`${PAINEL}/entrar`);
    conferir("a tela de entrada abre", entrada.status === 200, `status ${entrada.status}`);

    const errada = await fetch(`${PAINEL}/entrar`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ senha: "chute" }).toString(),
        redirect: "manual"
    });
    conferir("senha errada é recusada", errada.status === 401, `status ${errada.status}`);

    const certa = await fetch(`${PAINEL}/entrar`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ senha: senha ?? "" }).toString(),
        redirect: "manual"
    });
    conferir("senha certa entra", certa.status === 303, `status ${certa.status}`);

    const posto = certa.headers.get("set-cookie") ?? "";
    conferir("o cookie é HttpOnly", /HttpOnly/iu.test(posto), posto.slice(0, 60));
    conferir("o cookie é SameSite=Strict", /SameSite=Strict/iu.test(posto), posto.slice(0, 60));

    const cookie = posto.slice(0, posto.indexOf(";"));

    const comSessao = await fetch(`${PAINEL}/api/salao`, { headers: { cookie } });
    conferir("com sessão, o painel repassa a API", comSessao.status === 200, `status ${comSessao.status}`);

    const pagina = await fetch(`${PAINEL}/`, { headers: { cookie } });
    conferir("com sessão, o painel serve a tela", pagina.status === 200, `status ${pagina.status}`);

    const html = await pagina.text();
    conferir("o token não aparece no HTML servido", !html.includes(token), "TOKEN VAZANDO NO HTML");

    const forjado = `${cookie.split("=")[0]}=99999999999999.assinaturafalsa`;
    const comForjado = await fetch(`${PAINEL}/api/salao`, { headers: { cookie: forjado } });
    conferir("cookie forjado não entra", comForjado.status === 401, `status ${comForjado.status}`);

    const saiu = await fetch(`${PAINEL}/sair`, { headers: { cookie }, redirect: "manual" });
    conferir("/sair encerra a sessão", saiu.status === 303, `status ${saiu.status}`);
}

// ------------------------------------------------------------------------ fim
console.log(`\n${"=".repeat(60)}`);
console.log(`passou: ${passou}   falhou: ${falhou}`);
if (falhas.length > 0) {
    console.log("\nfalhas:");
    for (const f of falhas) console.log(`  - ${f}`);
}
process.exitCode = falhou === 0 ? 0 : 1;
