import { RepositorioDoSalaoEmMemoria } from "./repositorio-do-salao-em-memoria.js";
import { verificarContratoDoRepositorio } from "../../dominio/portas/contrato-do-repositorio.test.js";

verificarContratoDoRepositorio("em memória", (opcoes) => ({
    repositorio: new RepositorioDoSalaoEmMemoria({
        mesas: opcoes?.mesas,
        relogio: opcoes?.relogio
    }),
    fechar: () => {
        /* nada a fechar */
    }
}));
