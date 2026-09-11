/**
 * Superfície pública do pacote. Só reexporta: importar daqui nunca executa
 * nada — o serviço está em `main.ts` e a demonstração em `demo.ts`.
 */

// Domínio
export { Cliente } from "./dominio/entidades/cliente.js";
export { FilaDeEspera, type ItemFila } from "./dominio/entidades/fila-de-espera.js";
export { Mesa, StatusMesa } from "./dominio/entidades/mesa.js";
export {
    Salao,
    type InfoCliente,
    type InfoMesa,
    type RelatorioDoSalao,
    type ResultadoLiberacao,
    type ResultadoRecepcao,
    type ResultadoReserva
} from "./dominio/entidades/salao.js";
export { MotorGerente, type OpcoesDoMotor } from "./dominio/servicos/motor-gerente.js";

// Erros — o chamador decide pelo tipo, não pelo texto da mensagem
export {
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
    TransicaoInvalida
} from "./dominio/erros.js";

// Portas de saída
export type { RepositorioDoSalao } from "./dominio/portas/repositorio-do-salao.js";
export type { AvisoDeMesaPronta, Notificador } from "./dominio/portas/notificador.js";
export type {
    EstadoDaFila,
    EstadoDaMesa,
    EstadoDoCliente,
    EstadoDoItemFila,
    EstadoDoSalao
} from "./dominio/estado.js";

// Adaptadores
export {
    RepositorioDoSalaoEmMemoria,
    type OpcoesDoRepositorioEmMemoria
} from "./infra/memoria/repositorio-do-salao-em-memoria.js";
export {
    RepositorioDoSalaoSqlite,
    type OpcoesDoRepositorioSqlite
} from "./infra/sqlite/repositorio-do-salao-sqlite.js";
export { NotificadorDeLog } from "./infra/notificacao/notificador-de-log.js";

// HTTP
export { criarServidor, type OpcoesDoServidor } from "./http/servidor.js";
export {
    autenticadorAberto,
    autenticadorPorToken,
    type Autenticador
} from "./http/autenticacao.js";

// Tempo e log
export { type Relogio, relogioDoSistema } from "./compartilhado/tempo/relogio.js";
export {
    criarRegistradorJson,
    descreverErro,
    registradorSilencioso,
    type Campos,
    type Nivel,
    type Registrador
} from "./compartilhado/log/registrador.js";
