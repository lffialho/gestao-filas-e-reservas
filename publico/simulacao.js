/**
 * Simulação do salão: desenha a planta em projeção isométrica e conversa com
 * a mesma API HTTP que qualquer outro cliente usaria.
 *
 * A tela não tem regra de negócio nenhuma. Quem decide onde o cliente senta é
 * o servidor; aqui só se mostra o que ele respondeu. Arrastar uma mesa é um
 * POST em /mesas/:id/posicao — se o servidor recusar, a mesa volta para onde
 * estava, porque a verdade é dele.
 */

const COLUNAS = 12;
const LINHAS = 9;
const LADRILHO_L = 74; // largura do losango
const LADRILHO_A = 37; // altura do losango

const CORES = {
    DISPONIVEL: { topo: "#3f8d7f", lado: "#2c6559", borda: "#57b9a6" },
    RESERVADA: { topo: "#b5852e", lado: "#8a641f", borda: "#e0ac45" },
    OCUPADA: { topo: "#a8462f", lado: "#7d3322", borda: "#d1604a" }
};

const tela = document.getElementById("salao");
const pincel = tela.getContext("2d");

let salao = { mesas: [], taxaOcupacaoPercentual: 0, tempoMedioEsperaSegundos: 0, tamanhoFila: 0 };
let fila = [];
let selecionada = null;
let arraste = null;
let hover = null;

// ---------------------------------------------------------------- API ---

/**
 * O token da equipe fica em sessionStorage: some ao fechar a aba e não vaza
 * para o histórico do navegador. Se o serviço subiu com a API aberta, nunca
 * chega a ser pedido.
 */
let token = sessionStorage.getItem("salao-token") ?? "";

async function api(metodo, caminho, corpo) {
    const cabecalhos = {};
    if (token !== "") cabecalhos.Authorization = `Bearer ${token}`;
    if (corpo !== undefined) cabecalhos["Content-Type"] = "application/json";

    const resposta = await fetch(caminho, {
        method: metodo,
        headers: cabecalhos,
        ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) })
    });

    const texto = await resposta.text();
    const dados = texto === "" ? null : JSON.parse(texto);

    if (resposta.status === 401) {
        abrirPortao();
        const erro = new Error("Token da equipe ausente ou errado.");
        erro.tipo = "NaoAutenticado";
        throw erro;
    }

    if (!resposta.ok) {
        const erro = new Error(dados?.erro?.mensagem ?? `HTTP ${resposta.status}`);
        erro.tipo = dados?.erro?.tipo ?? "Erro";
        throw erro;
    }
    return dados;
}

function abrirPortao() {
    const portao = document.getElementById("portao");
    if (portao.hidden) {
        portao.hidden = false;
        document.getElementById("campo-token").focus();
    }
}

document.getElementById("form-token").addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const campo = document.getElementById("campo-token");
    token = campo.value.trim();
    sessionStorage.setItem("salao-token", token);
    campo.value = "";

    document.getElementById("portao").hidden = true;
    await sincronizar();
});

function avisar(mensagem, tipo) {
    const caixa = document.getElementById("aviso");
    caixa.textContent = mensagem;
    caixa.dataset.tipo = tipo ?? "info";
    caixa.hidden = false;
    clearTimeout(avisar.relogio);
    avisar.relogio = setTimeout(() => {
        caixa.hidden = true;
    }, 4200);
}

/** Erro de domínio é informação para quem opera, não falha do programa. */
async function executar(acao) {
    try {
        await acao();
        await sincronizar();
    } catch (erro) {
        if (erro.tipo !== "NaoAutenticado") {
            avisar(erro.message, "erro");
        }
        await sincronizar();
    }
}

// ------------------------------------------------------------ desenho ---

function paraTela(coluna, linha) {
    const origemX = tela.width / 2;
    const origemY = 92;
    return {
        x: origemX + (coluna - linha) * (LADRILHO_L / 2),
        y: origemY + (coluna + linha) * (LADRILHO_A / 2)
    };
}

/** Inverte a projeção: de pixel para ladrilho. */
function paraPlanta(x, y) {
    const origemX = tela.width / 2;
    const origemY = 92;
    const dx = (x - origemX) / (LADRILHO_L / 2);
    const dy = (y - origemY) / (LADRILHO_A / 2);
    return {
        coluna: Math.round((dy + dx) / 2),
        linha: Math.round((dy - dx) / 2)
    };
}

function losango(x, y, largura, altura) {
    pincel.beginPath();
    pincel.moveTo(x, y - altura / 2);
    pincel.lineTo(x + largura / 2, y);
    pincel.lineTo(x, y + altura / 2);
    pincel.lineTo(x - largura / 2, y);
    pincel.closePath();
}

function desenharPiso() {
    for (let linha = 0; linha < LINHAS; linha++) {
        for (let coluna = 0; coluna < COLUNAS; coluna++) {
            const { x, y } = paraTela(coluna, linha);
            const claro = (coluna + linha) % 2 === 0;

            losango(x, y, LADRILHO_L, LADRILHO_A);
            const alvo = arraste !== null && hover !== null && hover.coluna === coluna && hover.linha === linha;
            pincel.fillStyle = alvo ? "#2f4b46" : claro ? "#20292d" : "#1b2326";
            pincel.fill();
            pincel.strokeStyle = "#161d20";
            pincel.lineWidth = 1;
            pincel.stroke();
        }
    }
}

function desenharMesa(mesa, posicao, realcar) {
    const { x, y } = paraTela(posicao.coluna, posicao.linha);
    const cor = CORES[mesa.status] ?? CORES.DISPONIVEL;

    // Mesa maior ocupa mais do ladrilho: dá para ler a capacidade de longe.
    const escala = Math.min(0.82, 0.44 + mesa.capacidade * 0.055);
    const largura = LADRILHO_L * escala;
    const altura = LADRILHO_A * escala;
    const espessura = 13;

    pincel.save();
    if (realcar) {
        pincel.shadowColor = "rgba(0,0,0,.55)";
        pincel.shadowBlur = 18;
        pincel.shadowOffsetY = 7;
    }

    // corpo
    pincel.beginPath();
    pincel.moveTo(x - largura / 2, y);
    pincel.lineTo(x, y + altura / 2);
    pincel.lineTo(x + largura / 2, y);
    pincel.lineTo(x + largura / 2, y + espessura);
    pincel.lineTo(x, y + altura / 2 + espessura);
    pincel.lineTo(x - largura / 2, y + espessura);
    pincel.closePath();
    pincel.fillStyle = cor.lado;
    pincel.fill();

    // tampo
    losango(x, y, largura, altura);
    pincel.fillStyle = cor.topo;
    pincel.fill();
    pincel.strokeStyle = realcar ? "#ffffff" : cor.borda;
    pincel.lineWidth = realcar ? 2 : 1.2;
    pincel.stroke();
    pincel.restore();

    // número da mesa
    pincel.fillStyle = "rgba(255,255,255,.92)";
    pincel.font = "600 13px 'Segoe UI', sans-serif";
    pincel.textAlign = "center";
    pincel.textBaseline = "middle";
    pincel.fillText(String(mesa.numero), x, y);

    // lugares
    pincel.fillStyle = "rgba(255,255,255,.5)";
    pincel.font = "10px 'Segoe UI', sans-serif";
    pincel.fillText(`${mesa.capacidade} lug.`, x, y + altura / 2 + espessura + 9);

    if (mesa.cliente !== null) {
        pincel.fillStyle = "rgba(255,255,255,.88)";
        pincel.font = "600 11px 'Segoe UI', sans-serif";
        pincel.fillText(mesa.cliente.nome, x, y - altura / 2 - 10);
    }
}

function desenhar() {
    pincel.clearRect(0, 0, tela.width, tela.height);
    desenharPiso();

    // Do fundo para a frente, senão mesa de trás cobre a da frente.
    const ordenadas = salao.mesas
        .filter((m) => m.posicao !== null)
        .map((mesa) => ({
            mesa,
            posicao: arraste !== null && arraste.id === mesa.id && hover !== null ? hover : mesa.posicao
        }))
        .sort((a, b) => a.posicao.coluna + a.posicao.linha - (b.posicao.coluna + b.posicao.linha));

    for (const { mesa, posicao } of ordenadas) {
        desenharMesa(mesa, posicao, selecionada === mesa.id || arraste?.id === mesa.id);
    }
}

// ----------------------------------------------------------- arrastar ---

function pontoDoEvento(evento) {
    const caixa = tela.getBoundingClientRect();
    return {
        x: ((evento.clientX - caixa.left) / caixa.width) * tela.width,
        y: ((evento.clientY - caixa.top) / caixa.height) * tela.height
    };
}

function mesaEm(coluna, linha) {
    return salao.mesas.find(
        (m) => m.posicao !== null && m.posicao.coluna === coluna && m.posicao.linha === linha
    );
}

function dentroDaPlanta(p) {
    return p.coluna >= 0 && p.linha >= 0 && p.coluna < COLUNAS && p.linha < LINHAS;
}

tela.addEventListener("pointerdown", (evento) => {
    const { x, y } = pontoDoEvento(evento);
    const alvo = paraPlanta(x, y);
    if (!dentroDaPlanta(alvo)) return;

    const mesa = mesaEm(alvo.coluna, alvo.linha);
    if (mesa === undefined) return;

    tela.setPointerCapture(evento.pointerId);
    tela.classList.add("arrastando");
    arraste = { id: mesa.id, origem: mesa.posicao, moveu: false };
    hover = mesa.posicao;
    desenhar();
});

tela.addEventListener("pointermove", (evento) => {
    if (arraste === null) return;

    const { x, y } = pontoDoEvento(evento);
    const alvo = paraPlanta(x, y);
    if (!dentroDaPlanta(alvo)) return;

    if (hover === null || hover.coluna !== alvo.coluna || hover.linha !== alvo.linha) {
        hover = alvo;
        arraste.moveu = true;
        desenhar();
    }
});

tela.addEventListener("pointerup", async (evento) => {
    if (arraste === null) return;

    tela.releasePointerCapture(evento.pointerId);
    tela.classList.remove("arrastando");

    const { id, origem, moveu } = arraste;
    const destino = hover;
    arraste = null;
    hover = null;

    // Clique sem arrastar seleciona a mesa.
    if (!moveu || destino === null || (destino.coluna === origem.coluna && destino.linha === origem.linha)) {
        selecionada = id;
        desenhar();
        mostrarDetalhe();
        return;
    }

    selecionada = id;
    await executar(() => api("POST", `/mesas/${encodeURIComponent(id)}/posicao`, destino));
});

// ------------------------------------------------------------ painel ---

function mostrarDetalhe() {
    const caixa = document.getElementById("detalhe-mesa");
    const acoes = document.getElementById("acoes-mesa");
    const mesa = salao.mesas.find((m) => m.id === selecionada);

    acoes.replaceChildren();

    if (mesa === undefined) {
        caixa.className = "detalhe vazio";
        caixa.textContent = "Nenhuma mesa selecionada.";
        return;
    }

    caixa.className = "detalhe";
    caixa.innerHTML = `
        <dl>
            <dt>Mesa</dt><dd>${mesa.numero} <span class="selo" data-status="${mesa.status}">${mesa.status}</span></dd>
            <dt>Lugares</dt><dd>${mesa.capacidade}</dd>
            <dt>Ocupante</dt><dd>${mesa.cliente === null ? "—" : `${escapar(mesa.cliente.nome)} (${mesa.cliente.quantidadePessoas}p)`}</dd>
        </dl>`;

    const botao = (texto, classe, acao) => {
        const b = document.createElement("button");
        b.textContent = texto;
        if (classe) b.className = classe;
        b.addEventListener("click", () => executar(acao));
        acoes.append(b);
    };

    if (mesa.status === "RESERVADA") {
        botao("Sentou", "", () => api("POST", `/mesas/${mesa.id}/ocupacao`));
        botao("Cancelar reserva", "secundario", () => api("DELETE", `/mesas/${mesa.id}/reserva`));
    }
    if (mesa.status === "OCUPADA") {
        botao("Foi embora", "perigo", () => api("POST", `/mesas/${mesa.id}/liberacao`));
    }
}

function escapar(texto) {
    return String(texto).replace(/[&<>"']/g, (c) =>
        ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
    );
}

function mostrarFila() {
    const lista = document.getElementById("fila");
    document.getElementById("fila-contador").textContent = String(fila.length);
    lista.replaceChildren();

    if (fila.length === 0) {
        const p = document.createElement("p");
        p.className = "vazio-lista";
        p.textContent = "Ninguém esperando.";
        lista.append(p);
        return;
    }

    fila.forEach((item, indice) => {
        const li = document.createElement("li");
        li.innerHTML = `
            <span class="posicao">${indice + 1}</span>
            <span class="quem">
                <span class="nome">${escapar(item.nome)}</span>
                <span class="detalhes">${item.pessoas} pessoas · esperando há ${item.espera}</span>
            </span>`;

        const sair = document.createElement("button");
        sair.textContent = "×";
        sair.title = "Desistiu";
        sair.addEventListener("click", () =>
            executar(() => api("DELETE", `/fila/${encodeURIComponent(item.telefone)}`))
        );
        li.append(sair);
        lista.append(li);
    });
}

function mostrarIndicadores() {
    document.getElementById("ind-ocupacao").textContent = `${salao.taxaOcupacaoPercentual}%`;
    document.getElementById("ind-fila").textContent = String(salao.tamanhoFila);
    const s = salao.tempoMedioEsperaSegundos;
    document.getElementById("ind-espera").textContent = s < 60 ? `${s}s` : `${Math.round(s / 60)}min`;
}

function marcarConexao(estado, texto) {
    const caixa = document.getElementById("conexao");
    caixa.dataset.estado = estado;
    caixa.querySelector("span").textContent = texto;
}

// ------------------------------------------------------ sincronização ---

function desde(iso) {
    const segundos = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    return segundos < 60 ? `${segundos}s` : `${Math.floor(segundos / 60)}min`;
}

async function sincronizar() {
    try {
        const [relatorio, espera] = await Promise.all([api("GET", "/salao"), api("GET", "/fila")]);
        salao = relatorio;
        fila = espera.itens.map((i) => ({
            nome: i.cliente.nome,
            telefone: i.cliente.telefone,
            pessoas: i.cliente.quantidadePessoas,
            espera: desde(i.dataEntrada)
        }));

        marcarConexao("ligado", "ligado");
        desenhar();
        mostrarFila();
        mostrarIndicadores();
        mostrarDetalhe();
    } catch (erro) {
        marcarConexao("caiu", erro.tipo === "NaoAutenticado" ? "sem token" : "servidor fora");
    }
}

// -------------------------------------------------------- formulários ---

document.getElementById("form-chegada").addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const nome = document.getElementById("chegada-nome");
    const pessoas = document.getElementById("chegada-pessoas");
    const telefone = document.getElementById("chegada-telefone");

    await executar(async () => {
        const recepcao = await api("POST", "/chegadas", {
            nome: nome.value.trim(),
            pessoas: Number(pessoas.value),
            telefone: telefone.value.trim()
        });

        if (recepcao.destino === "mesa") {
            selecionada = recepcao.mesa.id;
            avisar(`${nome.value.trim()} sentou na mesa ${recepcao.mesa.numero}.`);
        } else {
            avisar(`${nome.value.trim()} entrou na fila, posição ${recepcao.posicao}.`);
        }
        nome.value = "";
        telefone.value = "";
        nome.focus();
    });
});

document.getElementById("form-mesa").addEventListener("submit", async (evento) => {
    evento.preventDefault();
    const numero = document.getElementById("mesa-numero");
    const capacidade = document.getElementById("mesa-capacidade");

    await executar(async () => {
        const mesa = await api("POST", "/mesas", {
            id: `m${numero.value}-${Date.now().toString(36).slice(-4)}`,
            numero: Number(numero.value),
            capacidade: Number(capacidade.value)
        });
        selecionada = mesa.id;
        avisar(`Mesa ${mesa.numero} posta no salão.`);
        numero.value = String(Number(numero.value) + 1);
    });
});

// Releitura periódica: mantém a espera da fila correndo e reflete mudanças
// feitas por outra aba ou pela API direto.
sincronizar();
setInterval(sincronizar, 5000);
