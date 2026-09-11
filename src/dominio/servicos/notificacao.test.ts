import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MotorGerente } from "./motor-gerente.js";
import { Cliente } from "../entidades/cliente.js";
import { Mesa } from "../entidades/mesa.js";
import type { AvisoDeMesaPronta, Notificador } from "../portas/notificador.js";
import { RepositorioDoSalaoEmMemoria } from "../../infra/memoria/repositorio-do-salao-em-memoria.js";
import { registradorSilencioso } from "../../compartilhado/log/registrador.js";

class NotificadorEspiao implements Notificador {
    readonly avisos: AvisoDeMesaPronta[] = [];
    falhar = false;

    async mesaPronta(aviso: AvisoDeMesaPronta): Promise<void> {
        if (this.falhar) {
            throw new Error("provedor de SMS fora do ar");
        }
        this.avisos.push(aviso);
    }
}

const cliente = (nome: string, pessoas: number, telefone: string): Cliente =>
    new Cliente(nome, pessoas, telefone);

function montar(notificador?: Notificador): MotorGerente {
    const repositorio = new RepositorioDoSalaoEmMemoria({
        mesas: [new Mesa("m1", 1, 4), new Mesa("m2", 2, 2)]
    });
    return new MotorGerente(repositorio, {
        ...(notificador === undefined ? {} : { notificador }),
        registrador: registradorSilencioso
    });
}

describe("aviso de mesa pronta", () => {
    it("avisa quem saiu da fila quando a mesa vira", async () => {
        const espiao = new NotificadorEspiao();
        const motor = montar(espiao);

        await motor.receberCliente(cliente("Ana", 4, "1111"));
        await motor.receberCliente(cliente("Bruno", 2, "2222"));
        await motor.receberCliente(cliente("Fernando", 2, "3333"));
        assert.deepEqual(espiao.avisos, [], "ninguém é avisado só por entrar na fila");

        await motor.liberarMesa("m2");

        assert.equal(espiao.avisos.length, 1);
        assert.deepEqual(espiao.avisos[0], {
            nome: "Fernando",
            telefone: "3333",
            mesaId: "m2",
            mesaNumero: 2
        });
    });

    it("avisa também quando uma reserva é cancelada e a mesa passa adiante", async () => {
        const espiao = new NotificadorEspiao();
        const motor = montar(espiao);

        await motor.receberCliente(cliente("Ana", 4, "1111"));
        await motor.receberCliente(cliente("Bruno", 2, "2222"));
        await motor.receberCliente(cliente("Fernando", 4, "3333"));

        await motor.cancelarReserva("m1");

        assert.equal(espiao.avisos.length, 1);
        assert.equal(espiao.avisos[0]?.nome, "Fernando");
    });

    it("não avisa quando ninguém na fila cabia na mesa", async () => {
        const espiao = new NotificadorEspiao();
        const motor = montar(espiao);

        await motor.receberCliente(cliente("Ana", 2, "1111"));
        await motor.liberarMesa("m2");

        assert.deepEqual(espiao.avisos, []);
    });

    // O anfitrião está sentando alguém que está na frente dele.
    it("não avisa quando o anfitrião senta o cliente na mão", async () => {
        const espiao = new NotificadorEspiao();
        const motor = montar(espiao);

        const fernando = cliente("Fernando", 2, "3333");
        await motor.entrarNaFila(fernando);
        await motor.fazerReserva("m2", fernando);

        assert.deepEqual(espiao.avisos, []);
    });

    /**
     * O ponto central: a mesa já é do cliente quando o aviso sai. Se o
     * provedor falhar, a alocação não pode ser desfeita.
     */
    it("falha de aviso não desfaz o atendimento", async () => {
        const espiao = new NotificadorEspiao();
        const motor = montar(espiao);

        await motor.receberCliente(cliente("Ana", 4, "1111"));
        await motor.receberCliente(cliente("Bruno", 2, "2222"));
        await motor.receberCliente(cliente("Fernando", 2, "3333"));

        espiao.falhar = true;
        const resultado = await motor.liberarMesa("m2");

        assert.equal(resultado.atendido?.nome, "Fernando", "o atendimento se manteve");
        assert.equal((await motor.consultarMesa("m2"))?.cliente?.nome, "Fernando");
        assert.equal(await motor.tamanhoFilaEspera(), 0, "ele saiu da fila mesmo assim");
    });

    it("funciona sem notificador configurado", async () => {
        const motor = montar();

        await motor.receberCliente(cliente("Ana", 4, "1111"));
        await motor.receberCliente(cliente("Bruno", 2, "2222"));
        await motor.receberCliente(cliente("Fernando", 2, "3333"));

        const resultado = await motor.liberarMesa("m2");
        assert.equal(resultado.atendido?.nome, "Fernando");
    });
});
