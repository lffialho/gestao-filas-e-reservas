import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { criarServidor } from "./servidor.js";
import { autenticadorPorToken } from "./autenticacao.js";
import { Mesa } from "../dominio/entidades/mesa.js";
import { MotorGerente } from "../dominio/servicos/motor-gerente.js";
import { RepositorioDoSalaoEmMemoria } from "../infra/memoria/repositorio-do-salao-em-memoria.js";

interface Resultado {
    status: number;
    json: any;
}

interface Api {
    pedir(metodo: string, caminho: string, corpo?: unknown): Promise<Resultado>;
    /** Envia o corpo exatamente como dado, para testar entrada malformada. */
    pedirBruto(metodo: string, caminho: string, corpoBruto: string): Promise<Resultado>;
    fechar(): Promise<void>;
}

/** Sobe um servidor em porta efêmera sobre um salão novo de 2, 4 e 6 lugares. */
async function subirApi(): Promise<Api> {
    const motor = new MotorGerente(
        new RepositorioDoSalaoEmMemoria({
            mesas: [new Mesa("m1", 1, 2), new Mesa("m2", 2, 4), new Mesa("m3", 3, 6)]
        })
    );
    // Erro inesperado falha o teste em vez de só sujar a saída; o log de
    // requisição é descartado para não poluir.
    const servidor: Server = criarServidor(motor, {
        registrador: {
            info: () => {},
            aviso: () => {},
            erro: (evento, campos) => assert.fail(`${evento} ${JSON.stringify(campos)}`)
        }
    });

    await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
    const { port } = servidor.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;

    const enviar = async (metodo: string, caminho: string, corpo?: string): Promise<Resultado> => {
        const resposta = await fetch(`${base}${caminho}`, {
            method: metodo,
            ...(corpo === undefined ? {} : { body: corpo, headers: { "Content-Type": "application/json" } })
        });
        const texto = await resposta.text();
        return { status: resposta.status, json: texto === "" ? null : JSON.parse(texto) };
    };

    return {
        pedir: (metodo, caminho, corpo) =>
            enviar(metodo, caminho, corpo === undefined ? undefined : JSON.stringify(corpo)),
        pedirBruto: (metodo, caminho, corpoBruto) => enviar(metodo, caminho, corpoBruto),
        fechar: () => new Promise<void>((resolve) => servidor.close(() => resolve()))
    };
}

/**
 * Cada bloco ganha o seu servidor. Testes de HTTP que compartilham um salão
 * ficam dependentes da ordem: um bloco muda a ocupação e o seguinte passa a
 * depender disso sem dizer.
 */
function comApiPropria(): () => Api {
    let instancia: Api;
    before(async () => {
        instancia = await subirApi();
    });
    after(async () => {
        await instancia.fechar();
    });
    return () => instancia;
}

describe("API HTTP", () => {
    describe("roteamento", () => {
        const api = comApiPropria();

        it("responde saúde", async () => {
            const { status, json } = await api().pedir("GET", "/saude");
            assert.equal(status, 200);
            assert.deepEqual(json, { status: "ok" });
        });

        it("404 em rota que não existe", async () => {
            const { status, json } = await api().pedir("GET", "/nao-existe");
            assert.equal(status, 404);
            assert.equal(json.erro.tipo, "RotaNaoEncontrada");
        });

        it("405 quando o caminho existe e o método não", async () => {
            const { status, json } = await api().pedir("DELETE", "/salao");
            assert.equal(status, 405);
            assert.equal(json.erro.tipo, "MetodoNaoPermitido");
        });
    });

    describe("corpo da requisição", () => {
        const api = comApiPropria();

        it("400 em JSON inválido", async () => {
            const { status, json } = await api().pedirBruto("POST", "/chegadas", "{isso nao e json");
            assert.equal(status, 400);
            assert.equal(json.erro.tipo, "DadosInvalidos");
        });

        it("400 quando o corpo é um array", async () => {
            const { status, json } = await api().pedir("POST", "/chegadas", [1, 2, 3]);
            assert.equal(status, 400);
            assert.equal(json.erro.tipo, "DadosInvalidos");
        });

        it("400 quando falta campo obrigatório", async () => {
            const { status, json } = await api().pedir("POST", "/chegadas", { nome: "Ana" });
            assert.equal(status, 400);
            assert.match(json.erro.mensagem, /pessoas/);
        });

        // Sem validação de forma no limite, isto seria 500 em vez de 400.
        it("400 quando o campo tem o tipo errado", async () => {
            const { status, json } = await api().pedir("POST", "/chegadas", {
                nome: 42,
                pessoas: "dois",
                telefone: "1111"
            });
            assert.equal(status, 400);
            assert.equal(json.erro.tipo, "DadosInvalidos");
        });
    });

    // Este bloco é deliberadamente sequencial: é um atendimento do começo ao fim.
    describe("fluxo de atendimento, na ordem", () => {
        const api = comApiPropria();

        it("recebe quem chega na menor mesa que serve", async () => {
            const { status, json } = await api().pedir("POST", "/chegadas", {
                nome: "Ana e Bruno",
                pessoas: 2,
                telefone: "1111-1111"
            });

            assert.equal(status, 201);
            assert.equal(json.destino, "mesa");
            assert.equal(json.mesa.capacidade, 2, "não gasta a mesa de 6 com um casal");
            assert.equal(json.mesa.cliente.nome, "Ana e Bruno");
        });

        it("consulta a mesa e vê o ocupante", async () => {
            const { status, json } = await api().pedir("GET", "/mesas/m1");
            assert.equal(status, 200);
            assert.equal(json.status, "RESERVADA");
            assert.equal(json.cliente.nome, "Ana e Bruno");
        });

        it("404 em mesa que não existe", async () => {
            const { status, json } = await api().pedir("GET", "/mesas/m99");
            assert.equal(status, 404);
            assert.equal(json.erro.tipo, "MesaNaoEncontrada");
        });

        it("marca que o grupo sentou", async () => {
            const { status, json } = await api().pedir("POST", "/mesas/m1/ocupacao");
            assert.equal(status, 200);
            assert.equal(json.status, "OCUPADA");
        });

        it("409 ao ocupar mesa que já está ocupada", async () => {
            const { status, json } = await api().pedir("POST", "/mesas/m1/ocupacao");
            assert.equal(status, 409);
            assert.equal(json.erro.tipo, "TransicaoInvalida");
        });

        it("manda para a fila quando nada serve, informando a posição", async () => {
            await api().pedir("POST", "/chegadas", { nome: "Quarteto", pessoas: 4, telefone: "2222-2222" });
            await api().pedir("POST", "/chegadas", { nome: "Sexteto", pessoas: 6, telefone: "3333-3333" });

            const { status, json } = await api().pedir("POST", "/chegadas", {
                nome: "Trio",
                pessoas: 3,
                telefone: "4444-4444"
            });

            assert.equal(status, 201);
            assert.equal(json.destino, "fila");
            assert.equal(json.posicao, 1);
            assert.equal(json.item.cliente.nome, "Trio");
            assert.equal(typeof json.item.dataEntrada, "string", "datas saem como ISO");
        });

        it("409 com detalhe quando um recém-chegado tentaria furar a fila", async () => {
            const { status, json } = await api().pedir("POST", "/mesas/m2/reserva", {
                nome: "Apressado",
                pessoas: 4,
                telefone: "5555-5555"
            });

            assert.equal(status, 409);
            assert.equal(json.erro.tipo, "FilaTemPrioridade");
            assert.equal(json.erro.clienteNaFila, "Trio", "o detalhe diz quem tem prioridade");
        });

        it("libera a mesa e informa quem assumiu", async () => {
            const { status, json } = await api().pedir("POST", "/mesas/m2/liberacao");

            assert.equal(status, 200);
            assert.equal(json.clienteAnterior.nome, "Quarteto");
            assert.equal(json.atendido.nome, "Trio", "o trio saiu da fila e ficou com a mesa");
            assert.equal(json.status, "RESERVADA");
        });

        it("cancela a reserva e devolve a mesa ao salão", async () => {
            const { status, json } = await api().pedir("DELETE", "/mesas/m3/reserva");
            assert.equal(status, 200);
            assert.equal(json.clienteAnterior.nome, "Sexteto");
            assert.equal(json.atendido, null, "a fila está vazia");

            const mesa = await api().pedir("GET", "/mesas/m3");
            assert.equal(mesa.json.status, "DISPONIVEL");
        });

        it("409 ao cancelar reserva que não existe", async () => {
            const { status, json } = await api().pedir("DELETE", "/mesas/m3/reserva");
            assert.equal(status, 409);
            assert.equal(json.erro.tipo, "CancelamentoInvalido");
        });

        it("409 ao liberar mesa que já está disponível", async () => {
            const { status, json } = await api().pedir("POST", "/mesas/m3/liberacao");
            assert.equal(status, 409);
            assert.equal(json.erro.tipo, "MesaJaDisponivel");
        });
    });

    describe("fila de espera", () => {
        const api = comApiPropria();

        /** Lota o salão, senão quem chega é sentado em vez de enfileirado. */
        const lotar = async (): Promise<void> => {
            await api().pedir("POST", "/chegadas", { nome: "Na m1", pessoas: 2, telefone: "0001" });
            await api().pedir("POST", "/chegadas", { nome: "Na m2", pessoas: 4, telefone: "0002" });
            await api().pedir("POST", "/chegadas", { nome: "Na m3", pessoas: 6, telefone: "0003" });
        };

        it("enfileira na ordem de chegada", async () => {
            await lotar();

            const primeiro = await api().pedir("POST", "/chegadas", {
                nome: "Desistente",
                pessoas: 2,
                telefone: "9999-9999"
            });
            const segundo = await api().pedir("POST", "/chegadas", {
                nome: "Outro",
                pessoas: 2,
                telefone: "8888-8888"
            });

            assert.equal(primeiro.json.posicao, 1);
            assert.equal(segundo.json.posicao, 2);
        });

        it("remove quem desiste", async () => {
            const { status, json } = await api().pedir("DELETE", "/fila/8888-8888");
            assert.equal(status, 200);
            assert.deepEqual(json, { saiuDaFila: true });

            const salao = await api().pedir("GET", "/salao");
            assert.equal(salao.json.tamanhoFila, 1);
        });

        it("404 ao remover telefone que não está na fila", async () => {
            const { status, json } = await api().pedir("DELETE", "/fila/0000-0000");
            assert.equal(status, 404);
            assert.equal(json.erro.tipo, "ClienteNaoEstaNaFila");
        });

        it("409 quando o mesmo telefone entra na fila duas vezes", async () => {
            const { status, json } = await api().pedir("POST", "/chegadas", {
                nome: "Desistente de novo",
                pessoas: 2,
                telefone: "9999-9999"
            });
            assert.equal(status, 409);
            assert.equal(json.erro.tipo, "ClienteJaNaFila");
        });
    });

    describe("relatório", () => {
        const api = comApiPropria();

        it("devolve números, não texto formatado", async () => {
            const { status, json } = await api().pedir("GET", "/salao");

            assert.equal(status, 200);
            assert.equal(typeof json.taxaOcupacaoPercentual, "number");
            assert.equal(typeof json.tempoMedioEsperaSegundos, "number");
            assert.equal(json.taxaOcupacaoPercentual, 0);
            assert.equal(json.mesas.length, 3);
        });
    });

    describe("cadastro de mesas", () => {
        const api = comApiPropria();

        it("cadastra e devolve 201", async () => {
            const { status, json } = await api().pedir("POST", "/mesas", {
                id: "m4",
                numero: 4,
                capacidade: 8
            });

            assert.equal(status, 201);
            assert.equal(json.id, "m4");
            assert.equal(json.status, "DISPONIVEL");
        });

        it("409 em id repetido", async () => {
            const { status, json } = await api().pedir("POST", "/mesas", {
                id: "m4",
                numero: 9,
                capacidade: 2
            });

            assert.equal(status, 409);
            assert.equal(json.erro.tipo, "MesaDuplicada");
        });

        it("400 em capacidade inválida", async () => {
            const { status, json } = await api().pedir("POST", "/mesas", {
                id: "m5",
                numero: 5,
                capacidade: 0
            });

            assert.equal(status, 400);
            assert.equal(json.erro.tipo, "DadosInvalidos");
        });
    });

    describe("autenticação", () => {
        let servidor: Server;
        let base: string;

        before(async () => {
            const motor = new MotorGerente(
                new RepositorioDoSalaoEmMemoria({ mesas: [new Mesa("m1", 1, 2)] })
            );
            servidor = criarServidor(motor, { autenticador: autenticadorPorToken("segredo") });
            await new Promise<void>((resolve) => servidor.listen(0, "127.0.0.1", resolve));
            base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
        });

        after(async () => {
            await new Promise<void>((resolve) => servidor.close(() => resolve()));
        });

        it("401 com WWW-Authenticate quando falta o token", async () => {
            const resposta = await fetch(`${base}/salao`);
            assert.equal(resposta.status, 401);
            assert.match(resposta.headers.get("WWW-Authenticate") ?? "", /Bearer/);
            assert.equal(((await resposta.json()) as any).erro.tipo, "NaoAutenticado");
        });

        it("401 com token errado", async () => {
            const resposta = await fetch(`${base}/salao`, { headers: { Authorization: "Bearer errado" } });
            assert.equal(resposta.status, 401);
        });

        it("passa com o token certo", async () => {
            const resposta = await fetch(`${base}/salao`, { headers: { Authorization: "Bearer segredo" } });
            assert.equal(resposta.status, 200);
        });

        // Health check não pode depender de credencial.
        it("/saude fica aberta", async () => {
            const resposta = await fetch(`${base}/saude`);
            assert.equal(resposta.status, 200);
        });

        // Sem token não se descobre o que existe na API.
        it("não deixa efeito algum antes de autenticar", async () => {
            const tentativa = await fetch(`${base}/mesas/m1/reserva`, {
                method: "POST",
                body: JSON.stringify({ nome: "Invasor", pessoas: 2, telefone: "1" }),
                headers: { "Content-Type": "application/json" }
            });
            assert.equal(tentativa.status, 401);

            const mesa = await fetch(`${base}/mesas/m1`, { headers: { Authorization: "Bearer segredo" } });
            assert.equal(((await mesa.json()) as any).status, "DISPONIVEL", "a reserva não aconteceu");
        });

        it("404 e 405 não exigem token", async () => {
            assert.equal((await fetch(`${base}/nao-existe`)).status, 404);
            assert.equal((await fetch(`${base}/salao`, { method: "DELETE" })).status, 405);
        });
    });

    describe("pedido que o salão nunca pode atender", () => {
        const api = comApiPropria();

        it("422 para grupo maior que a maior mesa", async () => {
            const { status, json } = await api().pedir("POST", "/chegadas", {
                nome: "Excursão",
                pessoas: 50,
                telefone: "7777-7777"
            });

            assert.equal(status, 422, "esperar não resolveria: não é 409");
            assert.equal(json.erro.tipo, "GrupoSemMesaPossivel");
            assert.equal(json.erro.maiorCapacidade, 6);
        });

        it("409 para grupo que não cabe na mesa pedida, mas caberia noutra", async () => {
            const { status, json } = await api().pedir("POST", "/mesas/m1/reserva", {
                nome: "Quarteto",
                pessoas: 4,
                telefone: "6666-6666"
            });

            assert.equal(status, 409, "conflito com aquela mesa, não com o salão");
            assert.equal(json.erro.tipo, "CapacidadeInsuficiente");
            assert.equal(json.erro.capacidade, 2);
        });
    });
});
