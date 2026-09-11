/**
 * Log estruturado. Uma linha JSON por evento, com campos nomeados em vez de
 * texto interpolado — é o que permite filtrar e agregar depois, em vez de
 * tentar extrair informação de frase com expressão regular.
 */
export type Nivel = "info" | "aviso" | "erro";

export type Campos = Record<string, unknown>;

export interface Registrador {
    info(evento: string, campos?: Campos): void;
    aviso(evento: string, campos?: Campos): void;
    erro(evento: string, campos?: Campos): void;
}

/** Extrai de um erro o que vale registrar, sem despejar o objeto inteiro. */
export function descreverErro(erro: unknown): Campos {
    if (erro instanceof Error) {
        return {
            erroTipo: erro.name,
            erroMensagem: erro.message,
            ...(erro.stack === undefined ? {} : { erroPilha: erro.stack })
        };
    }
    return { erroTipo: typeof erro, erroMensagem: String(erro) };
}

export interface OpcoesDoRegistradorJson {
    /** Para onde escrever. Padrão: stdout para info/aviso, stderr para erro. */
    escrever?: ((linha: string, nivel: Nivel) => void) | undefined;
    /** Campos fixos repetidos em toda linha (serviço, versão, ambiente). */
    contexto?: Campos | undefined;
    /** Relógio, para que o teste não dependa do tempo real. */
    agora?: (() => Date) | undefined;
}

export function criarRegistradorJson(opcoes: OpcoesDoRegistradorJson = {}): Registrador {
    const agora = opcoes.agora ?? ((): Date => new Date());
    const contexto = opcoes.contexto ?? {};

    const escrever =
        opcoes.escrever ??
        ((linha: string, nivel: Nivel): void => {
            if (nivel === "erro") {
                process.stderr.write(`${linha}\n`);
            } else {
                process.stdout.write(`${linha}\n`);
            }
        });

    const registrar = (nivel: Nivel, evento: string, campos: Campos = {}): void => {
        escrever(
            JSON.stringify({ momento: agora().toISOString(), nivel, evento, ...contexto, ...campos }),
            nivel
        );
    };

    return {
        info: (evento, campos) => registrar("info", evento, campos),
        aviso: (evento, campos) => registrar("aviso", evento, campos),
        erro: (evento, campos) => registrar("erro", evento, campos)
    };
}

/** Descarta tudo. Para testes que não querem saída. */
export const registradorSilencioso: Registrador = {
    info: () => {},
    aviso: () => {},
    erro: () => {}
};
