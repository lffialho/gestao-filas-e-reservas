import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Cliente } from "../entidades/cliente.js";
import { Mesa, StatusMesa } from "../entidades/mesa.js";
import type { Relogio } from "../../compartilhado/tempo/relogio.js";
import type { RepositorioDoSalao } from "./repositorio-do-salao.js";

export interface RepositorioParaTeste {
    repositorio: RepositorioDoSalao;
    fechar(): void;
}

export interface OpcoesDaFabrica {
    mesas?: readonly Mesa[] | undefined;
    relogio?: Relogio | undefined;
}

const cliente = (nome: string, pessoas: number, telefone: string): Cliente =>
    new Cliente(nome, pessoas, telefone);

const duasMesas = (): Mesa[] => [new Mesa("m1", 1, 4), new Mesa("m2", 2, 2)];

/**
 * Contrato da porta `RepositorioDoSalao`. Toda implementação roda esta suíte:
 * é o que garante que trocar memória por banco não muda o que o domínio pode
 * esperar. Um adaptador que passe aqui é intercambiável; um que não passe, não.
 */
export function verificarContratoDoRepositorio(
    nome: string,
    criar: (opcoes?: OpcoesDaFabrica) => RepositorioParaTeste
): void {
    describe(`contrato de RepositorioDoSalao — ${nome}`, () => {
        it("entrega à operação o salão com as mesas de abertura", async () => {
            const { repositorio, fechar } = criar({ mesas: duasMesas() });
            try {
                const total = await repositorio.transacao((salao) => salao.totalDeMesas);
                assert.equal(total, 2);
            } finally {
                fechar();
            }
        });

        it("devolve o valor que a operação retornou", async () => {
            const { repositorio, fechar } = criar({ mesas: duasMesas() });
            try {
                assert.equal(await repositorio.transacao(() => 42), 42);
                assert.equal(await repositorio.transacao(() => "texto"), "texto");
                assert.equal(await repositorio.transacao(() => undefined), undefined);
            } finally {
                fechar();
            }
        });

        it("uma transação vê o que a anterior gravou", async () => {
            const { repositorio, fechar } = criar({ mesas: duasMesas() });
            try {
                await repositorio.transacao((salao) => salao.receberCliente(cliente("Ana", 2, "1111")));

                const info = await repositorio.transacao((salao) => salao.consultarMesa("m2"));
                assert.equal(info?.status, StatusMesa.RESERVADA);
                assert.equal(info?.cliente?.nome, "Ana");
            } finally {
                fechar();
            }
        });

        it("preserva a ordem da fila entre transações", async () => {
            const { repositorio, fechar } = criar({ mesas: [new Mesa("unica", 1, 2)] });
            try {
                // Uma transação enfileira; outra libera a mesa. Se a ordem
                // sobreviveu à ida e volta do armazenamento, quem chegou
                // primeiro é quem senta.
                await repositorio.transacao((salao) => {
                    salao.receberCliente(cliente("Sentado", 2, "0000"));
                    salao.receberCliente(cliente("Primeiro", 2, "1111"));
                    salao.receberCliente(cliente("Segundo", 2, "2222"));
                });

                const atendido = await repositorio.transacao(
                    (salao) => salao.liberarMesa("unica").atendido?.nome
                );

                assert.equal(atendido, "Primeiro");
            } finally {
                fechar();
            }
        });

        it("preserva a hora de chegada de quem está na fila", async () => {
            const { repositorio, fechar } = criar({ mesas: [new Mesa("unica", 1, 2)] });
            try {
                const chegada = await repositorio.transacao((salao) => {
                    const item = salao.entrarNaFila(cliente("Ana", 2, "1111"));
                    return item.cliente.horaChegada.toISOString();
                });

                const depois = await repositorio.transacao((salao) => {
                    const item = salao.sairDaFila("1111");
                    return item?.cliente.horaChegada.toISOString();
                });

                assert.equal(depois, chegada, "um reinício não pode zerar a espera de quem aguarda");
            } finally {
                fechar();
            }
        });

        it("preserva o tempo médio de espera já contabilizado", async () => {
            const relogio = new (class implements Relogio {
                instante = 0;
                agora(): Date {
                    return new Date(this.instante);
                }
            })();
            const { repositorio, fechar } = criar({ mesas: duasMesas(), relogio });
            try {
                await repositorio.transacao((salao) => {
                    salao.receberCliente(cliente("Ana", 4, "1111"));
                    salao.receberCliente(cliente("Bruno", 2, "2222"));
                    salao.receberCliente(cliente("Fernando", 2, "3333"));
                });

                relogio.instante += 90_000;
                await repositorio.transacao((salao) => salao.liberarMesa("m2"));

                const medio = await repositorio.transacao((salao) => salao.tempoMedioEsperaSegundos);
                assert.equal(medio, 90);
            } finally {
                fechar();
            }
        });

        it("propaga o erro da operação preservando o tipo", async () => {
            const { repositorio, fechar } = criar({ mesas: duasMesas() });
            try {
                await assert.rejects(
                    repositorio.transacao((salao) => salao.liberarMesa("m1")),
                    { name: "MesaJaDisponivel" }
                );
                await assert.rejects(
                    repositorio.transacao((salao) => salao.liberarMesa("nao-existe")),
                    { name: "MesaNaoEncontrada" }
                );
            } finally {
                fechar();
            }
        });

        // O ponto central da transação: tudo ou nada.
        it("não deixa efeito quando a operação muda o salão e depois lança", async () => {
            const { repositorio, fechar } = criar({ mesas: duasMesas() });
            try {
                await assert.rejects(
                    repositorio.transacao((salao) => {
                        salao.entrarNaFila(cliente("Ana", 2, "1111"));
                        salao.receberCliente(cliente("Bruno", 2, "2222"));
                        throw new Error("falhou depois de mexer no salão");
                    }),
                    /falhou depois de mexer no salão/
                );

                const depois = await repositorio.transacao((salao) => ({
                    fila: salao.tamanhoFila,
                    ocupacao: salao.taxaDeOcupacao
                }));

                assert.equal(depois.fila, 0, "a entrada na fila foi desfeita");
                assert.equal(depois.ocupacao, 0, "a reserva foi desfeita");
            } finally {
                fechar();
            }
        });

        it("serializa transações concorrentes sem perder escrita", async () => {
            const { repositorio, fechar } = criar({ mesas: [new Mesa("unica", 1, 2)] });
            try {
                const quantos = 20;
                await Promise.all(
                    Array.from({ length: quantos }, (_, i) =>
                        repositorio.transacao((salao) =>
                            salao.entrarNaFila(cliente(`Cliente ${i}`, 2, `tel-${i}`))
                        )
                    )
                );

                const naFila = await repositorio.transacao((salao) => salao.tamanhoFila);
                assert.equal(naFila, quantos, "nenhuma escrita pode se perder entre transações");
            } finally {
                fechar();
            }
        });

        it("uma transação que falha não impede as seguintes", async () => {
            const { repositorio, fechar } = criar({ mesas: duasMesas() });
            try {
                await assert.rejects(
                    repositorio.transacao(() => {
                        throw new Error("boom");
                    })
                );

                const total = await repositorio.transacao((salao) => salao.totalDeMesas);
                assert.equal(total, 2, "o repositório continua usável");
            } finally {
                fechar();
            }
        });
    });
}
