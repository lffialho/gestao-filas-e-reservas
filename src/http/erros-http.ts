import {
    CancelamentoInvalido,
    CapacidadeInsuficiente,
    ClienteJaNaFila,
    DadosInvalidos,
    ErroDeDominio,
    FilaTemPrioridade,
    GrupoSemMesaPossivel,
    ItemForaDaFila,
    MesaDuplicada,
    MesaIndisponivel,
    MesaJaDisponivel,
    MesaNaoEncontrada,
    PosicaoForaDaPlanta,
    PosicaoOcupada,
    SalaoSemEspaco,
    TransicaoInvalida
} from "../dominio/erros.js";

/**
 * De erro de domínio para status HTTP. O mapa é explícito e exaustivo de
 * propósito: erro novo no domínio obriga a decidir o status aqui, em vez de
 * cair num padrão silencioso.
 *
 * - 400 o pedido está malformado;
 * - 404 o recurso não existe;
 * - 409 o pedido é válido mas conflita com o estado atual do salão;
 * - 422 o pedido é coerente e ainda assim este salão nunca pode atendê-lo.
 */
const STATUS_POR_ERRO: ReadonlyArray<readonly [new (...args: never[]) => ErroDeDominio, number]> = [
    [DadosInvalidos, 400],

    [MesaNaoEncontrada, 404],

    [MesaDuplicada, 409],
    [MesaIndisponivel, 409],
    [MesaJaDisponivel, 409],
    [CancelamentoInvalido, 409],
    [TransicaoInvalida, 409],
    [ClienteJaNaFila, 409],
    [FilaTemPrioridade, 409],
    [ItemForaDaFila, 409],
    [CapacidadeInsuficiente, 409],
    [PosicaoOcupada, 409],

    // Ladrilho fora da planta e planta lotada sao pedidos que esta planta
    // nunca atende, como o grupo grande demais.
    [PosicaoForaDaPlanta, 422],
    [SalaoSemEspaco, 422],

    // Nenhuma mesa do salão acomoda o grupo: esperar não resolveria.
    [GrupoSemMesaPossivel, 422]
];

export interface CorpoDeErro {
    erro: {
        tipo: string;
        mensagem: string;
        [campo: string]: unknown;
    };
}

/** Campos próprios do erro (mesaId, capacidade, ...), úteis ao cliente. */
function detalhesDo(erro: ErroDeDominio): Record<string, unknown> {
    const detalhes: Record<string, unknown> = {};
    for (const [chave, valor] of Object.entries(erro)) {
        if (chave !== "name") {
            detalhes[chave] = valor;
        }
    }
    return detalhes;
}

export interface RespostaDeErro {
    status: number;
    corpo: CorpoDeErro;
    /** Verdadeiro quando o erro não era previsto — vale registrar no log. */
    inesperado: boolean;
}

export function traduzirErro(erro: unknown): RespostaDeErro {
    if (erro instanceof ErroDeDominio) {
        const encontrado = STATUS_POR_ERRO.find(([classe]) => erro instanceof classe);

        // Erro de domínio sem status atribuído: 500, porque a omissão é nossa.
        if (encontrado === undefined) {
            return {
                status: 500,
                corpo: { erro: { tipo: "ErroInterno", mensagem: "Erro interno." } },
                inesperado: true
            };
        }

        return {
            status: encontrado[1],
            corpo: { erro: { tipo: erro.name, mensagem: erro.message, ...detalhesDo(erro) } },
            inesperado: false
        };
    }

    // Nada que não seja erro de domínio atravessa: mensagem genérica, sem vazar interno.
    return {
        status: 500,
        corpo: { erro: { tipo: "ErroInterno", mensagem: "Erro interno." } },
        inesperado: true
    };
}
