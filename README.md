# Gestão de filas e reservas

Backend para atendimento de salão de restaurante **por ordem de chegada**. Não há hora
marcada: quem chega é sentado na menor mesa que o acomoda ou entra na fila, e quando uma
mesa vira ela vai para o primeiro da fila que couber nela.

Sem dependências de runtime. Banco, servidor e testes usam só o que vem no Node
(`node:sqlite`, `node:http`, `node:test`).

## Rodar

```bash
npm install
npm run build
SALAO_TOKEN=um-token-secreto npm start
```

| Script | O que faz |
| --- | --- |
| `npm start` | Sobe o serviço (precisa de `dist/`, então rode `build` antes) |
| `npm run dev` | Serviço com recarga automática |
| `npm run build` | Compila para `dist/` |
| `npm test` | 145 testes |
| `npm run typecheck` | Só os tipos |
| `npm run lint` | Biome: lint e formatação |
| `npm run format` | Aplica as correções seguras do Biome |
| `npm run verificar` | lint + typecheck + testes + build, o que o CI roda |
| `npm run demo` | Roteiro de demonstração no terminal, sem HTTP |

### Simulação do salão

Com o serviço de pé, abra `http://localhost:3000` no navegador. Há uma simulação do salão em
vista isométrica: **arraste as mesas** para reorganizar a planta, receba clientes pelo painel
e acompanhe fila, ocupação e tempo médio de espera.

A tela não tem regra de negócio nenhuma — ela conversa com a mesma API HTTP que qualquer
outro cliente usaria. Quem decide onde o cliente senta é o servidor; arrastar uma mesa é um
`POST /mesas/:id/posicao`, e se o servidor recusar (ladrilho ocupado, fora da planta) a mesa
volta para onde estava, porque a verdade é dele.

A página pede o `SALAO_TOKEN` na primeira vez e o guarda só naquela aba. Para não servir a
interface, use `SALAO_INTERFACE=0`.

### Configuração

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `PORTA` | `3000` | Porta HTTP |
| `SALAO_TOKEN` | — | Token da equipe, exigido em toda rota menos `/saude` |
| `SALAO_SEM_AUTENTICACAO` | — | `1` abre a API. Só para desenvolvimento |
| `SALAO_BANCO` | — | Caminho de um arquivo SQLite. Sem ela o salão fica em memória e é perdido ao encerrar |
| `SALAO_INTERFACE` | — | `0` não serve a simulação, só a API |

**O serviço não sobe sem `SALAO_TOKEN`.** Uma API que opera o salão aberta por omissão é o
tipo de padrão que só se descobre errado depois; abrir tem de ser escolha declarada, via
`SALAO_SEM_AUTENTICACAO=1`.

```bash
PORTA=3131 SALAO_BANCO=./salao.db SALAO_TOKEN=segredo npm start
```

Para não repetir variável na linha de comando, copie `.env.example` para `.env` e use
`npm run start:env`. O `.env` fica fora do git.

## API

Autentique com `Authorization: Bearer <SALAO_TOKEN>` (ou `X-API-Key`). `/saude` fica aberta,
para health check.

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/saude` | Sinal de vida. Sem token |
| `GET` | `/salao` | Relatório: ocupação, tempo médio de espera, fila e mesas |
| `POST` | `/mesas` | Cadastra mesa — `{ id, numero, capacidade }` |
| `GET` | `/mesas/:id` | Estado da mesa e quem a ocupa |
| `POST` | `/chegadas` | **Cliente chegou** — `{ nome, pessoas, telefone }`. O salão decide entre mesa e fila |
| `DELETE` | `/fila/:telefone` | Desistência: sai da fila |
| `POST` | `/mesas/:id/reserva` | O anfitrião senta alguém numa mesa escolhida a dedo |
| `DELETE` | `/mesas/:id/reserva` | Cancela a reserva; a mesa vai para o próximo da fila que couber |
| `POST` | `/mesas/:id/ocupacao` | O grupo chegou à mesa e sentou |
| `POST` | `/mesas/:id/liberacao` | O grupo foi embora; a mesa vai para o próximo da fila que couber |
| `GET` | `/fila` | Quem está esperando, na ordem de chegada |
| `POST` | `/mesas/:id/posicao` | Arrasta a mesa na planta — `{ coluna, linha }` |

`POST /chegadas` é a porta de entrada normal. `POST /mesas/:id/reserva` existe para o
anfitrião escolher a mesa, e **continua respeitando a ordem de chegada**: se alguém na fila
cabe naquela mesa, só ele pode recebê-la.

```bash
curl -X POST localhost:3000/chegadas \
  -H 'Authorization: Bearer segredo' \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Ana e Bruno","pessoas":2,"telefone":"1111"}'
```

```json
{
  "destino": "mesa",
  "mesa": { "id": "m1", "numero": 1, "capacidade": 2, "status": "RESERVADA",
            "cliente": { "nome": "Ana e Bruno", "telefone": "1111", "quantidadePessoas": 2 } }
}
```

Quem não cabe em nada livre recebe `{"destino":"fila","posicao":1,"item":{…}}`.

### Erros

Todo erro sai como `{ "erro": { "tipo", "mensagem", ...campos } }`. O `tipo` é estável —
trate por ele, não pela mensagem. Campos extras vêm conforme o erro: `mesaId`, `capacidade`,
`clienteNaFila`, `maiorCapacidade`.

| Status | Quando | Exemplos de `tipo` |
| --- | --- | --- |
| `400` | Pedido malformado | `DadosInvalidos` |
| `401` | Token ausente ou errado | `NaoAutenticado` |
| `404` | Recurso não existe | `MesaNaoEncontrada`, `ClienteNaoEstaNaFila` |
| `405` | Método não aceito no recurso | `MetodoNaoPermitido` |
| `409` | Conflita com o estado atual do salão | `MesaIndisponivel`, `MesaJaDisponivel`, `FilaTemPrioridade`, `CapacidadeInsuficiente`, `ClienteJaNaFila` |
| `422` | Coerente, mas este salão nunca pode atender | `GrupoSemMesaPossivel`, `PosicaoForaDaPlanta`, `SalaoSemEspaco` |

A diferença entre `409` e `422` é proposital: pedir uma mesa de 2 para um grupo de 4 conflita
com *aquela* mesa (`409`, outra mesa pode servir); um grupo de 50 num salão cuja maior mesa
tem 6 lugares não tem solução nenhuma (`422`, esperar na fila não resolveria).

## Operação

O log é **uma linha JSON por evento**, com campos nomeados em vez de texto interpolado, para
poder filtrar e agregar:

```json
{"momento":"…","nivel":"info","evento":"requisicao","metodo":"POST","caminho":"/chegadas","status":201,"duracaoMs":2.26}
{"momento":"…","nivel":"info","evento":"aviso_mesa_pronta","cliente":"Helena","telefone":"6","mesaId":"m1","mesaNumero":1}
```

`info` e `aviso` vão para stdout, `erro` para stderr.

O encerramento em `SIGINT`/`SIGTERM` para de aceitar conexões, espera as em curso e só então
fecha o banco — fechar antes abortaria requisição que ainda responde. Há limite de 10s antes
de sair à força.

### Aviso ao cliente

Quando uma mesa vira e alguém sai da fila para ela, o `Notificador` é chamado.

Duas regras que o `MotorGerente` já respeita: o aviso sai **depois** da transação confirmar, e
falha de aviso **não** desfaz a alocação. A mesa já é daquele cliente; provedor fora do ar não
pode cancelar o atendimento.

O aviso vai para o **log** (`NotificadorDeLog`). Não há provedor de mensagem ligado: para
mandar SMS, WhatsApp ou qualquer outra coisa, implemente `Notificador` e entregue a
implementação no lugar dela — o domínio não muda, é para isso que a porta existe.

Se for ligar um provedor no Brasil, dois obstáculos que valem saber de antemão:

- **SMS** para números brasileiros exige registro prévio de sender ID junto às operadoras,
  com documentação e carta de autorização;
  [sender alfanumérico não funciona em conta de teste](https://support.twilio.com/hc/en-us/articles/223181348-Alphanumeric-Sender-ID-for-Twilio-Programmable-SMS)
  e tráfego não registrado costuma ser filtrado.
- **WhatsApp** trata como iniciada pela empresa toda mensagem que não seja resposta dentro de
  24h a uma mensagem do cliente, e exige
  [template pré-aprovado](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates)
  para essas. "Sua mesa está pronta" é exatamente esse caso, então o adaptador precisará
  mandar o identificador do template e as variáveis, não texto livre.

## Arquitetura

```
src/
  dominio/
    entidades/     Cliente, Mesa, FilaDeEspera, Salao, planta
    portas/        RepositorioDoSalao, Notificador
    servicos/      MotorGerente — serviço de aplicação, sem estado
    erros.ts       erros tipados; o chamador decide por instanceof
    estado.ts      retrato serializável, usado para persistir
  infra/
    memoria/       repositório em memória
    sqlite/        repositório em SQLite (node:sqlite)
    notificacao/   notificador que registra no log
  http/            servidor, rotas, autenticação, estáticos, erro → status
publico/           simulação do salão (HTML, CSS e canvas, sem build)
  compartilhado/   trava assíncrona, relógio injetável, log estruturado
  main.ts          ponto de entrada do serviço
  demo.ts          roteiro de demonstração
  index.ts         superfície pública do pacote (só reexporta)
```

Quatro decisões explicam o resto:

**Posição é planta, não regra.** Mesa tem lugar no salão porque estabelecimento real tem
disposição de mesas, e quem opera precisa reconhecer "a mesa do canto". Mas nenhuma regra de
alocação usa posição: quem senta onde continua sendo decidido por capacidade e ordem de
chegada. Há teste fixando isso — a mesa pequena no fundo vence a grande na entrada.

**O agregado é o salão, não a mesa.** Mesas e fila precisam mudar juntas para continuarem
coerentes — dar uma mesa a alguém é, no mesmo instante, tirá-lo da fila. Por isso a
consistência se define no salão inteiro, e é ele que se carrega e grava.

**A transação é a unidade de atomicidade.** `RepositorioDoSalao.transacao` recebe uma operação
**síncrona**, de propósito: assim nenhuma E/S entra no meio de uma decisão de alocação. No
SQLite é `BEGIN IMMEDIATE` com `ROLLBACK`; em memória é uma trava mais restauração do estado
se a operação lançar. As duas implementações rodam a **mesma suíte de contrato**
(`dominio/portas/contrato-do-repositorio.test.ts`) — é o que garante que trocar memória por
banco não muda o que o domínio pode esperar.

**O tempo é injetável.** `Relogio` entra por construtor, então o tempo médio de espera é
testado sem esperar de verdade. Nenhum teste depende de `sleep`.

### Ferramental

O lint é o **Biome**, não ESLint: `typescript-eslint` exige TypeScript `<6.1` e este projeto
usa a versão 7, o port nativo — forçar instalaria um linter que depende de APIs internas do
compilador que mudaram. O Biome tem parser próprio e não depende da versão do TypeScript.

A regra `useLiteralKeys` está desligada: com `noUncheckedIndexedAccess`, acessar por colchete
(`process.env["PORTA"]`, `parametros["id"]`) sinaliza que a chave pode não existir, e o tipo
resultante inclui `undefined`. Trocar por ponto esconderia isso.

## Limitações conhecidas

- **Autenticação é um token único da equipe**, sem usuários nem papéis. Serve para API de
  retaguarda; uma API pública multiusuário precisa de credencial por pessoa.
- **O repositório em memória serializa por processo**; só o SQLite é seguro com mais de um
  processo escrevendo.
- **Não há provedor de mensagem ligado.** O aviso a quem sai da fila vai para o log; a porta
  `Notificador` está pronta para receber uma implementação de verdade.
- Sem rate limiting: um cliente autenticado pode inundar a API.
- Sem migrações de schema; o SQLite cria as tabelas se não existirem e nada versiona mudanças
  futuras.
