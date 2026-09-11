/**
 * Desenho do salão em projeção isométrica.
 *
 * Direção: sala de jogo isométrico dos anos 2000 — duas paredes ao fundo, chão
 * de madeira quadriculado, contorno grosso em tudo e cor chapada. Sem gradiente
 * e sem sombra desfocada: a profundidade vem da geometria e da aresta escura,
 * como nos jogos que essa tela homenageia.
 *
 * Separado de simulacao.js porque são coisas diferentes: aqui é pintura, lá é
 * conversa com o servidor.
 */

const COLUNAS = 12;
const LINHAS = 9;
const LADRILHO_L = 68;
const LADRILHO_A = 34;
const ALTURA_PAREDE = 104;

const TINTA = "#2f1d12";

const PISO = ["#c08a52", "#b07c47"];
const PAREDE_ESQ = "#e9d6ad";
const PAREDE_DIR = "#d8c294";
const RODAPE = "#8a5f38";

const MESA = {
    DISPONIVEL: { tampo: "#6fbc59", lado: "#4a8a39", aro: "#8fd97a" },
    RESERVADA: { tampo: "#f4b13f", lado: "#bd8118", aro: "#ffd27a" },
    OCUPADA: { tampo: "#dd6347", lado: "#a8402a", aro: "#ff8f75" }
};

/** Cores de camisa, para as pessoas não saírem todas iguais. */
const CAMISAS = ["#4f8fd0", "#d4574e", "#8a6fc4", "#3fa98a", "#d9922f", "#c25f9e"];

function corDaPessoa(semente) {
    let soma = 0;
    for (let i = 0; i < semente.length; i++) soma += semente.charCodeAt(i);
    return CAMISAS[soma % CAMISAS.length];
}

// --------------------------------------------------------------------------

export function criarPalco(tela) {
    const pincel = tela.getContext("2d");

    // Centraliza a grade: em isométrico ela é um losango, não um retângulo.
    const origem = {
        x: tela.width / 2 - ((COLUNAS - 1 - (LINHAS - 1)) * LADRILHO_L) / 4,
        y: ALTURA_PAREDE + 54
    };

    const paraTela = (coluna, linha) => ({
        x: origem.x + (coluna - linha) * (LADRILHO_L / 2),
        y: origem.y + (coluna + linha) * (LADRILHO_A / 2)
    });

    const paraPlanta = (x, y) => {
        const dx = (x - origem.x) / (LADRILHO_L / 2);
        const dy = (y - origem.y) / (LADRILHO_A / 2);
        return { coluna: Math.round((dy + dx) / 2), linha: Math.round((dy - dx) / 2) };
    };

    /** Cantos do losango de um ladrilho. */
    const cantos = (coluna, linha) => {
        const p = paraTela(coluna, linha);
        return {
            topo: { x: p.x, y: p.y - LADRILHO_A / 2 },
            direita: { x: p.x + LADRILHO_L / 2, y: p.y },
            baixo: { x: p.x, y: p.y + LADRILHO_A / 2 },
            esquerda: { x: p.x - LADRILHO_L / 2, y: p.y }
        };
    };

    const caminho = (pontos) => {
        pincel.beginPath();
        pincel.moveTo(pontos[0].x, pontos[0].y);
        for (let i = 1; i < pontos.length; i++) pincel.lineTo(pontos[i].x, pontos[i].y);
        pincel.closePath();
    };

    const pintar = (pontos, preenchimento, contorno, espessura) => {
        caminho(pontos);
        pincel.fillStyle = preenchimento;
        pincel.fill();
        if (contorno !== undefined) {
            pincel.strokeStyle = contorno;
            pincel.lineWidth = espessura ?? 2;
            pincel.lineJoin = "round";
            pincel.stroke();
        }
    };

    // ------------------------------------------------------------ sala ---

    function desenharParedes() {
        const fundo = cantos(0, 0).topo;
        const pontaDireita = cantos(COLUNAS - 1, 0).direita;
        const pontaEsquerda = cantos(0, LINHAS - 1).esquerda;
        const subir = (p) => ({ x: p.x, y: p.y - ALTURA_PAREDE });

        // Direita primeiro: a esquerda encosta por cima, formando o canto.
        pintar([pontaDireita, fundo, subir(fundo), subir(pontaDireita)], PAREDE_DIR, TINTA, 3);
        pintar([fundo, pontaEsquerda, subir(pontaEsquerda), subir(fundo)], PAREDE_ESQ, TINTA, 3);

        // Rodapé: a faixa que dá peso ao encontro da parede com o chão.
        const alturaRodape = 11;
        const baixar = (p, q) => ({ x: p.x, y: p.y - q });
        pintar(
            [pontaDireita, fundo, baixar(fundo, alturaRodape), baixar(pontaDireita, alturaRodape)],
            RODAPE,
            TINTA,
            2
        );
        pintar(
            [fundo, pontaEsquerda, baixar(pontaEsquerda, alturaRodape), baixar(fundo, alturaRodape)],
            RODAPE,
            TINTA,
            2
        );
    }

    function desenharPiso(destaque) {
        for (let linha = 0; linha < LINHAS; linha++) {
            for (let coluna = 0; coluna < COLUNAS; coluna++) {
                const c = cantos(coluna, linha);
                const alvo =
                    destaque !== null && destaque.coluna === coluna && destaque.linha === linha;

                pintar(
                    [c.topo, c.direita, c.baixo, c.esquerda],
                    alvo ? "#f0d08a" : PISO[(coluna + linha) % 2],
                    "rgba(47,29,18,.22)",
                    1
                );
            }
        }

        // Contorno do salão inteiro, para o chão não se dissolver no fundo.
        const c00 = cantos(0, 0);
        const cD = cantos(COLUNAS - 1, 0);
        const cE = cantos(0, LINHAS - 1);
        const cF = cantos(COLUNAS - 1, LINHAS - 1);
        caminho([c00.topo, cD.direita, cF.baixo, cE.esquerda]);
        pincel.strokeStyle = TINTA;
        pincel.lineWidth = 3;
        pincel.stroke();
    }

    // ----------------------------------------------------------- gente ---

    /** Boneco simples: sombra, corpo, cabeça. Contorno grosso em tudo. */
    function desenharPessoa(x, y, semente, altura) {
        const a = altura ?? 30;
        const largura = a * 0.42;

        pincel.save();
        pincel.globalAlpha = 0.22;
        pincel.fillStyle = "#000";
        pincel.beginPath();
        pincel.ellipse(x, y, largura * 0.85, largura * 0.38, 0, 0, Math.PI * 2);
        pincel.fill();
        pincel.restore();

        const corpoTopo = y - a * 0.62;
        pintar(
            [
                { x: x - largura / 2, y: corpoTopo },
                { x: x + largura / 2, y: corpoTopo },
                { x: x + largura * 0.62, y: y - 2 },
                { x: x - largura * 0.62, y: y - 2 }
            ],
            corDaPessoa(semente),
            TINTA,
            2
        );

        const raio = a * 0.21;
        pincel.beginPath();
        pincel.arc(x, corpoTopo - raio * 0.75, raio, 0, Math.PI * 2);
        pincel.fillStyle = "#f0c8a0";
        pincel.fill();
        pincel.strokeStyle = TINTA;
        pincel.lineWidth = 2;
        pincel.stroke();

        // Cabelo: meia-lua no topo, só para os bonecos não ficarem carecas iguais.
        pincel.beginPath();
        pincel.arc(x, corpoTopo - raio * 0.75, raio, Math.PI * 1.08, Math.PI * 1.92);
        pincel.strokeStyle = "#4a3222";
        pincel.lineWidth = 3.5;
        pincel.stroke();
    }

    // ------------------------------------------------------------ mesa ---

    function desenharCadeiras(centro, largura, quantas) {
        const lados = [
            { dx: -largura * 0.72, dy: -LADRILHO_A * 0.16 },
            { dx: largura * 0.72, dy: -LADRILHO_A * 0.16 },
            { dx: -largura * 0.72, dy: LADRILHO_A * 0.3 },
            { dx: largura * 0.72, dy: LADRILHO_A * 0.3 }
        ];

        for (let i = 0; i < Math.min(quantas, 4); i++) {
            const l = lados[i];
            const x = centro.x + l.dx;
            const y = centro.y + l.dy;
            const c = 7;
            pintar(
                [
                    { x, y: y - c * 0.55 },
                    { x: x + c, y },
                    { x, y: y + c * 0.55 },
                    { x: x - c, y }
                ],
                "#8a5f38",
                TINTA,
                2
            );
        }
    }

    function desenharMesa(mesa, posicao, selecionada) {
        const centro = paraTela(posicao.coluna, posicao.linha);
        const cor = MESA[mesa.status] ?? MESA.DISPONIVEL;

        // Mesa maior ocupa mais do ladrilho: dá para ler a lotação de longe.
        const escala = Math.min(0.78, 0.42 + mesa.capacidade * 0.05);
        const lg = LADRILHO_L * escala;
        const al = LADRILHO_A * escala;
        const espessura = 9;
        const perna = 13;

        desenharCadeiras(centro, lg / 2, Math.ceil(mesa.capacidade / 2) * 2);

        // Pernas, antes do tampo, para ficarem por baixo.
        for (const dx of [-lg * 0.3, lg * 0.3]) {
            pintar(
                [
                    { x: centro.x + dx - 2.5, y: centro.y + al * 0.1 },
                    { x: centro.x + dx + 2.5, y: centro.y + al * 0.1 },
                    { x: centro.x + dx + 2.5, y: centro.y + al * 0.1 + perna },
                    { x: centro.x + dx - 2.5, y: centro.y + al * 0.1 + perna }
                ],
                "#6b4526",
                TINTA,
                2
            );
        }

        // Espessura do tampo.
        pintar(
            [
                { x: centro.x - lg / 2, y: centro.y },
                { x: centro.x, y: centro.y + al / 2 },
                { x: centro.x + lg / 2, y: centro.y },
                { x: centro.x + lg / 2, y: centro.y + espessura },
                { x: centro.x, y: centro.y + al / 2 + espessura },
                { x: centro.x - lg / 2, y: centro.y + espessura }
            ],
            cor.lado,
            TINTA,
            2.5
        );

        // Tampo.
        pintar(
            [
                { x: centro.x, y: centro.y - al / 2 },
                { x: centro.x + lg / 2, y: centro.y },
                { x: centro.x, y: centro.y + al / 2 },
                { x: centro.x - lg / 2, y: centro.y }
            ],
            cor.tampo,
            selecionada ? "#fff" : TINTA,
            selecionada ? 3.5 : 2.5
        );

        // Brilho no canto superior: dá volume sem gradiente.
        pintar(
            [
                { x: centro.x, y: centro.y - al / 2 + 2 },
                { x: centro.x + lg / 2 - 5, y: centro.y - 1 },
                { x: centro.x, y: centro.y - al / 2 + 7 }
            ],
            cor.aro
        );

        // Quem está na mesa fica ao lado dela, não em cima.
        if (mesa.cliente !== null) {
            desenharPessoa(centro.x - lg * 0.34, centro.y + al * 0.1, mesa.cliente.nome, 28);
        }

        etiqueta(String(mesa.numero), centro.x, centro.y + al / 2 + espessura + 12, cor.tampo);
    }

    /** Plaquinha com o número da mesa. */
    function etiqueta(texto, x, y, fundo) {
        pincel.font = "bold 11px Tahoma, Verdana, sans-serif";
        const largura = Math.max(18, pincel.measureText(texto).width + 12);

        pincel.beginPath();
        pincel.roundRect(x - largura / 2, y - 8, largura, 16, 5);
        pincel.fillStyle = fundo;
        pincel.fill();
        pincel.strokeStyle = TINTA;
        pincel.lineWidth = 2;
        pincel.stroke();

        pincel.fillStyle = TINTA;
        pincel.textAlign = "center";
        pincel.textBaseline = "middle";
        pincel.fillText(texto, x, y);
    }

    // ------------------------------------------------------------ fila ---

    /** A fila espera na entrada, à frente do salão. */
    function desenharFila(fila) {
        if (fila.length === 0) return;

        const entrada = cantos(COLUNAS - 1, LINHAS - 1).baixo;
        const visiveis = fila.slice(0, 6);

        visiveis.forEach((pessoa, i) => {
            const x = entrada.x - 26 - i * 30;
            const y = entrada.y + 26 + i * 9;
            desenharPessoa(x, y, pessoa.telefone, 26);
        });

        pincel.font = "bold 11px Tahoma, Verdana, sans-serif";
        pincel.fillStyle = "#fdf3dd";
        pincel.textAlign = "right";
        pincel.textBaseline = "alphabetic";
        const rotulo =
            fila.length > visiveis.length
                ? `esperando: ${fila.length} (+${fila.length - visiveis.length} fora)`
                : `esperando: ${fila.length}`;
        pincel.fillText(rotulo, entrada.x + 4, entrada.y + 20);
    }

    // ---------------------------------------------------------- pintar ---

    function desenhar(estado) {
        pincel.clearRect(0, 0, tela.width, tela.height);
        desenharParedes();
        desenharPiso(estado.destaque);

        // Do fundo para a frente, senão a mesa de trás cobre a da frente.
        const ordenadas = estado.mesas
            .filter((m) => m.posicao !== null)
            .map((mesa) => ({
                mesa,
                posicao:
                    estado.arrastando === mesa.id && estado.destaque !== null
                        ? estado.destaque
                        : mesa.posicao
            }))
            .sort((a, b) => a.posicao.coluna + a.posicao.linha - (b.posicao.coluna + b.posicao.linha));

        for (const { mesa, posicao } of ordenadas) {
            desenharMesa(mesa, posicao, estado.selecionada === mesa.id || estado.arrastando === mesa.id);
        }

        desenharFila(estado.fila);
    }

    return { desenhar, paraPlanta, COLUNAS, LINHAS };
}
