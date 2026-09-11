import { FalhaNoProvedor, NotificadorTwilio } from "../infra/notificacao/notificador-twilio.js";
import { paraE164 } from "../infra/notificacao/telefone-e164.js";
import { DadosInvalidos } from "../dominio/erros.js";

/**
 * Manda um aviso de teste pelo provedor configurado.
 *
 * Existe para separar dois problemas que, juntos, são difíceis de
 * diagnosticar: "a credencial e o canal estão certos?" e "o fluxo do salão
 * chama o aviso na hora certa?". Esta ferramenta responde só a primeira.
 *
 *     node --env-file=.env dist/ferramentas/testar-aviso.js +5511999999999
 */

function exigir(nome: string): string {
    const valor = process.env[nome];
    if (valor === undefined || valor.trim() === "") {
        console.error(`Falta a variável ${nome}.`);
        console.error("Preencha o .env a partir do .env.example e rode de novo.");
        process.exit(1);
    }
    return valor;
}

/** Mostra só o começo e o fim: confere o valor sem expor o segredo. */
function mascarar(valor: string): string {
    if (valor.length <= 8) {
        return "********";
    }
    return `${valor.slice(0, 4)}…${valor.slice(-4)}`;
}

const destino = process.argv[2];

if (destino === undefined || destino.trim() === "") {
    console.error("Uso: node --env-file=.env dist/ferramentas/testar-aviso.js <telefone>");
    console.error("Exemplo: node --env-file=.env dist/ferramentas/testar-aviso.js +5511999999999");
    process.exit(1);
}

const contaSid = exigir("TWILIO_ACCOUNT_SID");
const tokenDeAutenticacao = exigir("TWILIO_AUTH_TOKEN");
const remetente = exigir("TWILIO_REMETENTE");
const canal = process.env["TWILIO_CANAL"] === "whatsapp" ? "whatsapp" : "sms";
const paisPadrao = process.env["SALAO_PAIS_PADRAO"] ?? "55";

let destinoE164: string;
try {
    destinoE164 = paraE164(destino, paisPadrao);
} catch (erro) {
    const mensagem = erro instanceof DadosInvalidos ? erro.message : String(erro);
    console.error(`Telefone inválido: ${mensagem}`);
    process.exit(1);
}

console.log("Enviando aviso de teste");
console.log(`  conta ......... ${mascarar(contaSid)}`);
console.log(`  token ......... ${mascarar(tokenDeAutenticacao)}`);
console.log(`  canal ......... ${canal}`);
console.log(`  remetente ..... ${remetente}`);
console.log(`  destino ....... ${destino} → ${destinoE164}`);
console.log("");

const notificador = new NotificadorTwilio({
    contaSid,
    tokenDeAutenticacao,
    remetente,
    canal,
    paisPadrao
});

try {
    await notificador.mesaPronta({
        nome: "Teste",
        telefone: destino,
        mesaId: "teste",
        mesaNumero: 1
    });

    console.log("A Twilio aceitou a mensagem.");
    console.log("Confira o aparelho. Se não chegar, veja o Messaging Log no console da Twilio:");
    console.log("  a Twilio aceita primeiro e entrega depois, então recusa da operadora aparece lá.");
} catch (erro) {
    if (!(erro instanceof FalhaNoProvedor)) {
        console.error("Não deu para falar com a Twilio:", erro instanceof Error ? erro.message : erro);
        console.error("Verifique conexão e se a hora do sistema está certa (TLS é sensível a isso).");
        process.exit(1);
    }

    console.error(`A Twilio recusou. HTTP ${erro.status}, código ${erro.codigoDoProvedor ?? "—"}.`);
    console.error(`  ${erro.message}`);
    if (erro.maisInfo !== null) {
        console.error(`  Documentação do código: ${erro.maisInfo}`);
    }
    console.error("");
    console.error("Causas comuns:");
    console.error("  · credencial errada — confira Account SID e Auth Token no console;");
    console.error("  · no sandbox de WhatsApp, o aparelho de destino ainda não entrou:");
    console.error("    mande o código de adesão pelo WhatsApp para o número do sandbox;");
    console.error("  · remetente errado — no WhatsApp use o número do sandbox, não o seu;");
    console.error("  · em conta de teste com SMS, o destino precisa ser um número verificado.");
    process.exit(1);
}
