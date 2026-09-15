# Gestão de filas e reservas

Backend para atendimento de salão de restaurante por ordem de chegada. Não há hora
marcada: quem chega é sentado na menor mesa que o acomoda ou entra na fila, e quando uma
mesa vira ela vai para o primeiro da fila que couber nela.

O serviço é só backend: domínio, persistência e API HTTP. O painel web vive em `web/`, num
processo próprio, e fala com ele apenas por HTTP — `src/` não sabe que existe interface, e
qualquer outro cliente que fale HTTP serve igual.

Sem dependências de runtime. Banco, servidor e testes usam só o que vem no Node
(`node:sqlite`, `node:http`, `node:test`).

## Rodar

```bash
npm install
npm run build
npm run start:env
```

`start:env` lê a configuração de um arquivo `.env`, então funciona igual em qualquer shell —
sem sintaxe de variável de ambiente. Comece copiando o exemplo:

```bash
cp .env.example .env      # PowerShell: Copy-Item .env.example .env
```

Se preferir passar na linha de comando, a sintaxe muda conforme o shell:

```bash
# bash, zsh
SALAO_TOKEN=um-token-secreto npm start
```

```powershell
# PowerShell
$env:SALAO_TOKEN = "um-token-secreto"; npm start
```

| Script | O que faz |
| --- | --- |
| `npm run start:env` | Sobe o serviço lendo o `.env` — funciona em qualquer shell |
| `npm start` | Sobe o serviço com as variáveis já no ambiente |
| `npm run dev` | Serviço com recarga automática |
| `npm run build` | Compila para `dist/` |
| `npm run tudo:env` | Sobe serviço e painel juntos, lendo o `.env`, e levanta de novo o que cair |
| `npm test` | 389 testes |
| `npm run typecheck` | Só os tipos |
| `npm run lint` | Biome: lint e formatação |
| `npm run format` | Aplica as correções seguras do Biome |
| `npm run verificar` | lint + typecheck + testes + build, o que o CI roda |
| `npm run conferir:instalacao` | Confere uma instalação no ar, de fora — 59 verificações |
| `npm run suporte` | Junta num arquivo só o que o suporte pergunta |
| `npm run demo` | Roteiro de demonstração no terminal, sem HTTP |
| `npm run web:build` | Compila o painel: servidor para `web/dist/`, navegador para `web/publico/js/` |
| `npm run web:env` | Sobe o painel lendo o `.env` |

### Configuração

| Variável | Padrão | Efeito |
| --- | --- | --- |
| `PORTA` | `3000` | Porta HTTP |
| `SALAO_TOKEN` | — | Token da equipe, exigido em toda rota menos `/saude` |
| `SALAO_SEM_AUTENTICACAO` | — | `1` abre a API. Só para desenvolvimento |
| `SALAO_BANCO` | — | Caminho de um arquivo SQLite. Sem ela o salão fica em memória e é perdido ao encerrar |
| `SALAO_BACKUP` | — | `0` desliga as cópias do banco |
| `SALAO_BACKUP_PASTA` | `backups/` ao lado do banco | Onde as cópias ficam |
| `SALAO_BACKUP_HORAS` | `6` | De quantas em quantas horas copiar |
| `SALAO_BACKUP_COPIAS` | `28` | Quantas cópias guardar — 28 × 6 h ≈ uma semana |
| `SALAO_BACKUP_ESPELHO` | — | Segunda pasta que recebe cópia de cada cópia. Aponte para o OneDrive |
| `SALAO_PULSO_URL` | — | Para onde avisar que a casa está funcionando. Sem ela, sem pulso |
| `SALAO_PULSO_MINUTOS` | `5` | De quantos em quantos minutos avisar |
| `SALAO_CASA` | — | Nome desta casa, para quem recebe o pulso distinguir |
| `SALAO_RETENCAO_DIAS` | `90` | Depois disso, nome e telefone saem do diário. `0` desliga |
| `SALAO_LOG_ARQUIVO` | — | Guarda o log também num arquivo, com rodízio. Sem ela, só stdout |
| `PORTA_WEB` | `5173` | Porta do painel, que roda num processo próprio |
| `SALAO_API` | `http://127.0.0.1:3000` | Onde o painel procura a API |
| `PAINEL_SENHA_ARQUIVO` | `painel-senha.json` na raiz | Onde a senha do painel fica guardada, como hash |
| `PAINEL_SEM_SENHA` | — | `1` abre o painel a quem alcançar a porta. Só para desenvolvimento |

A porta do serviço aparece em duas variáveis — `PORTA`, para ele, e `SALAO_API`, para o
painel achá-lo — e o `.env.example` já traz as duas preenchidas. Mudar uma sem mudar a
outra deixa o painel batendo numa porta vazia: ele sobe, a tela abre e nada carrega.
`npm run tudo` confere isso antes de subir e recusa com a mensagem certa; `npm start` e
`npm run web`, rodados separados, não têm como conferir.

O serviço não sobe sem `SALAO_TOKEN`. Uma API que opera o salão aberta por omissão é o tipo
de padrão que só se descobre errado depois; abrir tem de ser escolha declarada, via
`SALAO_SEM_AUTENTICACAO=1`.

### Migrações

Bancos de versões anteriores se atualizam sozinhos ao abrir. As mudanças de esquema são
numeradas em `src/infra/sqlite/migracoes.ts` e aplicadas em ordem, uma transação cada; o
número já aplicado mora em `PRAGMA user_version`, no cabeçalho do próprio arquivo.

Isso importa porque, depois da primeira instalação, não se controla mais qual versão roda em
cada casa — e uma que passe meses sem atualizar recebe várias mudanças de uma vez. Se alguma
falhar no meio, nada dela vale e a versão não sobe; abrir de novo retoma de onde parou.

Banco mais novo que o programa é recusado com o motivo escrito. Voltar uma versão é o que se
faz quando uma atualização dá problema, e aí o banco já tem o formato novo: seguir em frente
seria gravar por cima com o formato antigo.

## Instalar na máquina do balcão

Rodar na mão com `npm run tudo:env` serve para testar. Numa casa que abre todo dia o salão
precisa subir sozinho ao ligar o computador e voltar sozinho se cair.

```powershell
npm install
npm run build
npm run web:build
Copy-Item .env.example .env     # preencha SALAO_TOKEN e SALAO_BANCO
powershell -ExecutionPolicy Bypass -File ferramentas\instalar-windows.ps1
```

Precisa ser um PowerShell como administrador: tarefas na raiz do Agendador exigem elevação.

O script confere o que precisa estar pronto — Node 22 ou mais novo, os dois builds, o `.env`
com token — e registra duas tarefas, uma para o serviço e outra para o painel. Rodar de novo
atualiza em vez de duplicar.

Cada tarefa tem dois gatilhos: um sobe o salão ao entrar na conta, outro repete a cada dois
minutos. O segundo existe porque o reinício-em-falha do Agendador não bastou — matando o
processo, a tarefa ficou em "Ready" e o salão passou 150 s fora do ar sem tentar subir.
`RestartCount` cobre a tarefa que falha, não o processo que some. Com os dois gatilhos e
`MultipleInstances = IgnoreNew`, o mesmo teste voltou sozinho em 123 s.

Vale repetir isso depois de instalar: mate o `node` do serviço e confira que
`http://localhost:3000/saude` responde de novo em até dois minutos.

Terminada a instalação, abra `http://localhost:5173` e crie a senha do painel.

`ferramentas\desinstalar-windows.ps1` tira as tarefas e não toca no banco nem nas cópias.

### Conferir a instalação

`npm test` prova o domínio. Isto prova a instalação: HTTP, token, SQLite e painel de verdade,
com os dois processos no ar.

```bash
npm run conferir:instalacao -- --pode-escrever
```

São 59 verificações — autenticação, ordem de chegada, a fila ganhando de mesa vazia, os
códigos de erro, o diário e a senha do painel. Quando falha, diz em qual parou.

Ele escreve no salão, então pede `--pode-escrever` e se recusa a rodar com mesa ocupada ou
gente na fila. Os eventos que gera ficam no diário; para apagar, restaure a cópia anterior.

### As cópias do banco

Uma cópia é gravada ao subir e a cada seis horas, em `backups/` ao lado do banco. Sai por
`VACUUM INTO`, que é como o SQLite copia um banco em uso — a cópia vem de uma leitura
transacional e nunca pega metade de uma operação. Copiar o `.db` por fora pode pegá-lo no
meio de uma escrita e gerar um arquivo que não abre.

Cópia no mesmo disco não protege contra o disco morrer. Para isso existe
`SALAO_BACKUP_ESPELHO`, uma segunda pasta que recebe cópia de cada cópia:

```
SALAO_BACKUP_ESPELHO=C:\Users\voce\OneDrive\Salao
```

Aponte para a pasta local do OneDrive, do Drive ou de um pendrive — são arquivos comuns e
quem sincroniza é o programa que a casa já tem. Falhar no espelho não derruba a cópia local,
mas aparece em `/saude`.

A pasta do espelho é criada, a de cima não. Um caminho errado, ou no formato de outro sistema
(`/c/Users/...`), o Windows resolve a partir da raiz do disco — com criação recursiva a
árvore nasceria ali e a cópia daria "certo" num canto que ninguém sincroniza.

O serviço tenta uma última cópia ao encerrar, mas não conte com ela no Windows: parar a tarefa
no Agendador encerra o processo sem entregar sinal, e o código de encerramento não roda. Quem
garante é a cópia periódica, então a mais recente pode ser de até seis horas atrás.

### Restaurar

Backup que nunca foi restaurado é um arquivo que se espera que sirva. Por isso restaurar é um
script, e não um parágrafo de instruções para seguir na pior noite possível.

```powershell
powershell -ExecutionPolicy Bypass -File ferramentas\restaurar-windows.ps1 -Ensaio
```

`-Ensaio` mostra o que ele faria sem alterar nada. Sem a opção, ele lista as cópias, pergunta
qual, e então: confere a cópia antes de tocar no banco atual, para as tarefas e espera o
arquivo ser solto, guarda o banco atual com `-wal` e `-shm` numa pasta com a data, copia,
confere de novo o que ficou no lugar e sobe o serviço.

Para conferir uma cópia sem restaurar nada:

```bash
node ferramentas/conferir-copia.mjs backups/salao-2026-09-14T19-11-37-984Z.db
```

Abre só para leitura, roda `integrity_check`, exige as tabelas do salão e mostra quantas
mesas, quantos na fila e quantos eventos há — a cópia de um salão vazio abre perfeitamente, e
é esse o engano caro na hora de restaurar.

### Dado pessoal e LGPD

O salão guarda nome e telefone de quem chega: é o telefone que serve de identidade. Num
software vendido a estabelecimentos, esse dado é de clientes de terceiros.

O diário é o registro do que aconteceu, não um cadastro de clientes. Eventos com mais de
`SALAO_RETENCAO_DIAS` têm nome e telefone anulados, ao subir e uma vez por dia. Isso não custa
nenhum número do relatório: o esquema separa o que identifica do que conta, então mesa,
capacidade, pessoas, espera e permanência ficam. É `UPDATE`, nunca `DELETE` — apagar a linha
mudaria o passado dos relatórios.

Para quem pedir para ser esquecido:

```bash
curl -X DELETE -H "Authorization: Bearer $SALAO_TOKEN"   "http://localhost:3000/clientes/%2B5511999998888"
```

Tira o dado daquele telefone do diário inteiro e responde 200 mesmo quando não havia nada. Não
mexe em quem está sentado ou na fila agora.

Estão feitos os mecanismos técnicos: minimização, retenção e eliminação a pedido. Aviso de
privacidade, base legal e o contrato entre quem vende e a casa que opera não estão, e são
trabalho de advogado.

### Quando algo dá errado

Rodando como tarefa do Agendador o log vai para stdout e se perde. Com `SALAO_LOG_ARQUIVO` ele
passa a ser guardado em arquivo, com rodízio de quatro arquivos de 5 MB.

```bash
npm run suporte
```

Gera um `suporte-<data>.txt` com sistema, versão, datas dos builds, saúde do serviço, estado
das cópias e as últimas 500 linhas do log.

Pode ser enviado por e-mail: nome e telefone saem mascarados na escrita do log, então
`DELETE /fila/+5511987654321` fica `DELETE /fila/••••4321`. Do `.env` vão só os nomes das
variáveis e se estão preenchidas — o token e a senha do painel nunca entram.

### Sistema online

Quem vende o salão precisa saber que uma casa está quieta sem esperar o telefone tocar.

```
SALAO_PULSO_URL=https://seu-monitor/ping/cantina-do-ze
SALAO_CASA=cantina-do-ze
```

A cada cinco minutos a casa manda um POST dizendo que está funcionando. Só sai HTTPS —
perguntar de fora exigiria que cada balcão tivesse endereço alcançável, o que um PC atrás de
NAT não tem. Aponte para um serviço que alerte quando o sinal para de chegar e não há servidor
nenhum para escrever.

Vai junto a saúde do backup, porque um salão no ar que parou de copiar há três dias responde
igual a um saudável:

```json
{"casa":"cantina-do-ze","momento":"2026-09-15T01:37:12.121Z",
 "backup":{"ultimaCopiaEm":"2026-09-15T01:37:12.087Z","falhasSeguidas":0,"espelhoEm":null}}
```

Nenhum dado de cliente atravessa: saem contagens e horários, e nem o caminho dos arquivos. Há
teste travando o formato. Pulso que não chega não derruba nada e fica registrado em `/saude`.

## API

Autentique com `Authorization: Bearer <SALAO_TOKEN>` (ou `X-API-Key`). O nome do esquema é
case-insensitive, como manda a RFC 7235; o token, não. `/saude` fica aberta, para health
check — e `HEAD` funciona em toda rota que aceita `GET`.

Parâmetros de caminho são percent-decodificados: um telefone em E.164 vai como
`/fila/%2B5511999999999`.

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/saude` | Sinal de vida e como anda o backup. Sem token |
| `GET` | `/salao` | Retrato de agora: ocupação, tempo médio de espera, fila e mesas |
| `GET` | `/relatorio` | Fechamento de um período — `?de=<ISO>&ate=<ISO>` |
| `GET` | `/eventos` | O diário cru do período — `?de=<ISO>&ate=<ISO>&limite=<1..500>` |
| `POST` | `/mesas` | Cadastra mesa — `{ id, numero, capacidade }`. Se alguém na fila couber nela, já nasce reservada |
| `GET` | `/mesas/:id` | Estado da mesa e quem a ocupa |
| `DELETE` | `/mesas/:id` | Tira a mesa da planta. Mesa ocupada ou já chamada não sai |
| `POST` | `/chegadas` | Cliente chegou — `{ nome, pessoas, telefone }`. O salão decide entre mesa e fila |
| `GET` | `/chegadas/previa` | Onde esse grupo iria parar, sem mudar nada — `?pessoas=N&telefone=<opcional>` |
| `DELETE` | `/fila/:telefone` | Desistência: sai da fila |
| `DELETE` | `/clientes/:telefone` | Esquecimento (LGPD): tira nome e telefone do diário |
| `POST` | `/mesas/:id/reserva` | O anfitrião senta alguém numa mesa escolhida a dedo |
| `DELETE` | `/mesas/:id/reserva` | Cancela a reserva; a mesa vai para o próximo da fila que couber |
| `POST` | `/mesas/:id/ocupacao` | O grupo chegou à mesa e sentou |
| `POST` | `/mesas/:id/liberacao` | O grupo foi embora; a mesa vai para o próximo da fila que couber |
| `GET` | `/fila` | Quem está esperando, na ordem de chegada |
| `POST` | `/mesas/:id/posicao` | Arrasta a mesa na planta — `{ coluna, linha }` |

`POST /chegadas` é a porta de entrada normal. `POST /mesas/:id/reserva` existe para o
anfitrião escolher a mesa, e continua respeitando a ordem de chegada: se alguém na fila
cabe naquela mesa, só ele pode recebê-la — e quem senta é o cliente que já estava na fila,
com a hora de chegada dele. Se o nome ou o tamanho do grupo do pedido não baterem com o que
está na fila, a resposta é `409 IdentidadeDivergente` em vez de uma troca silenciosa.

Toda mesa diz desde quando. O campo `desde` marca o instante em que a mesa entrou no
status atual, e muda só nas transições — arrastar a mesa na planta não faz o grupo sentar de
novo. É daí que saem duas coisas que o status sozinho não responde: há quanto tempo o grupo
está na mesa, e há quanto tempo quem foi chamado ainda não apareceu. Bancos de versões
anteriores ganham a coluna na primeira abertura, contando a partir da migração — não há como
descobrir depois quando cada mesa entrou no status em que está.

O diário diz o que aconteceu. O estado responde como o salão está agora; nenhuma
pergunta sobre o passado — maior espera da noite, pico da fila, quantas vezes cada mesa
girou — cabe nele. Por isso cada operação também deixa eventos, e o repositório os grava na
mesma transação do estado: evento escrito depois sobreviveria a um rollback, e o relatório
passaria a contar atendimento que não houve.

`GET /relatorio?de=…&ate=…` resume um período. As bordas vêm em ISO de quem chama, porque só
o cliente sabe onde começa "hoje" no fuso do restaurante. Dois números pedem leitura atenta:
a espera média é de quem passou pela fila — juntar os zeros de quem sentou direto mediria
o quanto o salão estava vazio, não quanto se espera quando há espera; e o pico da fila
conta a partir de zero no começo do período, sem saber quantos já aguardavam antes dele.

`GET /eventos?de=…&ate=…` devolve os mesmos fatos sem somar nada, do mais recente para o mais
antigo, com `{ itens, total }`. São perguntas diferentes: o resumo responde "como foi a
noite", o diário responde "o que acabou de acontecer". `limite` corta a resposta, não a
leitura — o período é lido inteiro de qualquer jeito, e o corte existe para o painel não
arrastar o dia todo a cada atualização; por isso `total` conta o período, não a fatia.

O telefone é a identidade. O mesmo número não pode estar em duas mesas, nem sentado e na
fila ao mesmo tempo — é por ele que se desiste da fila e é para ele que o aviso de mesa
pronta vai.

`GET /chegadas/previa?pessoas=…` responde o que aconteceria se esse grupo chegasse agora:
`{ destino: "mesa" | "fila" | "recusa", mesa, posicao, motivo }`. É leitura pura — nada muda
no salão — e chama exatamente o mesmo cálculo que `POST /chegadas` faria, inclusive a regra
de que uma mesa livre não serve se alguém que já espera também caberia nela. Existe para o
painel poder mostrar o destino a quem ainda está digitando sem uma segunda cópia da regra
na tela: duas cópias divergem, e a tela passaria a prometer mesa que o salão não daria. Na
recusa, `motivo` é o mesmo `tipo` do erro que a chegada de verdade lançaria; o texto a
mostrar é escolhido por quem apresenta. O telefone é opcional — sem ele a resposta considera
só o tamanho do grupo.

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
            "desde": "2026-09-13T23:12:04.118Z",
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
| `409` | Conflita com o estado atual do salão | `MesaIndisponivel`, `MesaJaDisponivel`, `MesaEmUso`, `FilaTemPrioridade`, `CapacidadeInsuficiente`, `ClienteJaNaFila`, `ClienteJaNoSalao`, `IdentidadeDivergente`, `NumeroDeMesaDuplicado` |
| `422` | Coerente, mas este salão nunca pode atender | `GrupoSemMesaPossivel`, `PosicaoForaDaPlanta`, `SalaoSemEspaco` |

A diferença entre `409` e `422` é proposital: pedir uma mesa de 2 para um grupo de 4 conflita
com *aquela* mesa (`409`, outra mesa pode servir); um grupo de 50 num salão cuja maior mesa
tem 6 lugares não tem solução nenhuma (`422`, esperar na fila não resolveria).

## Painel

```bash
npm run build && npm run web:build
npm run start:env     # o serviço, porta 3000
npm run web:env       # o painel, porta 5173
```

Dois processos, de propósito. O painel existe por causa do token: `SALAO_TOKEN` é segredo
único da equipe, e em JavaScript de navegador qualquer um que abra o devtools libera todas as
mesas do salão. Então `web/servidor` guarda o token, serve `web/publico/` e repassa `/api/...`
para o serviço pondo o cabeçalho ali. O `Authorization` que chega do navegador é descartado —
quem fala com o serviço não escolhe a credencial.

### A senha do painel

O painel guarda o token e escuta na rede, então quem abre `http://<ip-do-balcão>:5173`
manda no salão sem precisar de token. Por isso ele tem senha própria: o token é o que o
painel usa para falar com o serviço, a senha é o que uma pessoa usa para falar com o painel.

Não há senha em arquivo de configuração nem senha padrão — quem opera cria a dela na primeira
vez que o painel abre. Enquanto ela não existe, qualquer caminho leva a `/criar-senha` e nem
o CSS é servido. Depois de criada, esse caminho passa a mandar para `/entrar`.

| Caminho | O que faz |
| --- | --- |
| `/criar-senha` | Primeira abertura. Some depois que a senha existe |
| `/entrar` | Pede a senha, uma vez a cada 12 h |
| `/trocar-senha` | Exige a senha atual, mesmo de quem já está logado |
| `/sair` | Encerra a sessão deste aparelho |

A mesma senha vale no computador do balcão e no tablet, cada um com a própria sessão. O que
fica em disco é o hash, em `painel-senha.json` (fora do git), por `scrypt` — que é lento de
propósito, ao contrário de SHA-256 puro. Esqueceu? Apague o arquivo e o painel pede uma nova.

A sessão é um cookie `HttpOnly`, `SameSite=Strict`, assinado com uma chave derivada do hash.
Como a chave vem do hash, trocar a senha derruba as sessões abertas, e reiniciar o painel não
derruba ninguém. Senha errada custa 400 ms e vai para o log; o mínimo é 8 caracteres.

O cookie não é `Secure` porque o painel roda em `http://` na rede local, e um cookie `Secure`
não seria enviado. Quem lê o tráfego da rede lê o cookie — numa rede compartilhada com os
clientes, a resposta é separar a rede, não trocar a senha.

### O que está na tela

A planta é a grade 12 × 9 do domínio com as mesas por cima. Verde é livre, âmbar é
chamada, vermelho é ocupada — e nada mais no painel usa essas três cores, para que não
percam o sentido. As bolinhas em volta são os lugares: dá para contar as cadeiras e ver que
sobram duas na mesa de quatro. Ao lado, quatro números (ocupação, maior mesa livre, espera
média, fila), o diário do dia e, embaixo, a fila — com o próximo aberto por inteiro e o resto
resumido, porque num salão de quarenta mesas ninguém opera lendo trinta cartões.

Clicar numa mesa abre o que dá para fazer com ela: *sentou*, *devolver para a fila*, *liberou
a mesa*. O que tira a mesa de alguém pede um segundo toque. Clicar em quem espera oferece
tirá-lo da fila. A resposta do serviço vira frase — "Mesa 3 liberada e chamada para Ana" —
em vez de mandar conferir na tela.

Em Chegou alguém, enquanto se digita, uma linha diz onde o grupo vai parar: "Senta na
mesa 3", "Entra na fila, na posição 2", "Este telefone já está na mesa 3". Essa resposta vem
de `GET /chegadas/previa`, não de um cálculo aqui — a razão está na seção da API. O botão
continua valendo mesmo quando a prévia recusa: a prévia é um retrato de alguns segundos
atrás, e quem decide de verdade é o serviço, no momento do envio.

### Montar o salão

Montar salão liga um modo à parte, e é à parte de propósito: quem opera clica em mesa a
noite inteira para sentar e liberar gente, e se arrastar também mexesse na planta um dedo
escorregando no tablet mudaria o salão no meio do movimento. Ligado o modo, a planta muda de
cara, clicar não senta ninguém, e dá para:

- pôr mesa — número já sugerido no menor livre, lugares, e ela entra no primeiro espaço
  vago da planta;
- arrastar para o lugar dela, com o dedo ou o mouse, encaixando no ladrilho;
- tirar da planta — só mesa livre. Mesa ocupada, ou já chamada para alguém que está a
  caminho, não sai: sumiria com um atendimento em curso sem ninguém decidir o que fazer com
  quem está lá.

Enquanto uma mesa está na mão, a atualização automática não troca a planta por baixo dela —
é a mesma disciplina da caixa de busca e da janela de ação, aplicada ao arrasto.

Tirar mesa da planta não apaga o passado dela: cada evento do diário carrega o número e a
capacidade que a mesa tinha no momento em que aconteceu, justamente para que mexer na planta
hoje não mude o relatório de ontem.

### Fechar o dia

`/fechamento.html` é tela própria, e não janela sobre o painel, porque é feita para imprimir
e para exportar — página inteira se imprime com CSS normal, enquanto uma janela exigiria
esconder o resto da tela na impressão, regra que quebra ao primeiro elemento novo. Na
impressão as cores se invertem (o painel é escuro porque o salão é escuro; papel é branco) e
some tudo que só serve na tela.

O período é hoje, ontem ou um intervalo de datas. Como os números saem do diário,
e não do estado do salão, pedir ontem funciona e o relatório sobrevive a um reinício do
serviço no meio do expediente.

Dois arquivos saem em CSV, com `;` e BOM porque é o que abre certo no Excel em português (a
razão está em `csv.ts`):

- o resumo — os indicadores do período e a tabela por mesa, duas tabelas separadas por
  uma linha em branco no mesmo arquivo, que é como se olha a noite inteira de uma vez;
- o diário — um evento por linha, com o momento em ISO e a hora legível ao lado.
  Sem telefone: este arquivo sai do salão, e o relatório do dia não precisa levar junto
  uma lista de contatos de clientes para ser útil.

A mesa chamada tem prazo. `RESERVADA` já significa "chamada, ainda não sentou", e o
`desde` diz desde quando; o painel conta cinco minutos a partir daí e, quando estouram,
marca a mesa. Só marca: quem devolve a mesa é o maître, nunca o relógio — quem foi chamado
pode estar estacionando o carro, e um cancelamento automático daria a mesa dessa pessoa para
outra sem ninguém ter olhado.

Desenho por região. A tela se atualiza sozinha a cada três segundos, e o que a
atualização substitui é só o que veio do serviço: planta, números, diário e fila. A caixa de
busca e a janela de ação ficam de fora — um painel que apagasse o nome sendo digitado, ou que
fechasse a janela no meio de uma decisão, perderia a confiança de quem opera em um
expediente. Pela mesma razão os cliques são ouvidos nos contêineres, e não nos cartões: os
cartões são trocados, os contêineres não. E as contagens regressivas correm num tique local
de um segundo que só reescreve texto, para não ficarem tremendo junto com a rede.

Sem contato com o serviço, o último retrato fica na tela com um aviso dizendo de quando
ele é. Num salão cheio, o estado conhecido de um minuto atrás vale mais do que uma tela em
branco.

O fuso do restaurante mora no painel, em `web/navegador/tempo.ts` — hoje
`America/Sao_Paulo`. O serviço trabalha com instantes, e instante não tem fuso; "hoje" tem, e
quem sabe onde começa o dia é quem opera o salão. Fixar no painel também é mais correto do que
usar o fuso do aparelho: o tablet do balcão pode estar configurado de qualquer jeito, e o
relatório do dia não pode depender disso.

A posição do domínio é um ladrilho; o vão de vários ladrilhos que cada mesa ocupa na tela
é invenção do painel. Daí vem o único caso curioso: duas mesas a um ladrilho de distância são
legais no domínio e se cobririam no desenho. Quando isso acontece, a de número menor fica
onde está e a outra vai para o primeiro vão livre — mesa desenhada em outro canto ainda se
lê, duas mesas empilhadas não se leem nenhuma.

Nome de cliente é texto que alguém digitou no balcão, então nada no painel entra por
`innerHTML`: todo texto vai por `textContent`, e o que vem da API nunca vira marcação.

## Operação

O log é uma linha JSON por evento, com campos nomeados em vez de texto interpolado, para
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

Duas regras que o `MotorGerente` já respeita: o aviso sai depois da transação confirmar, e
falha de aviso não desfaz a alocação. A mesa já é daquele cliente; provedor fora do ar não
pode cancelar o atendimento.

Não há API de notificação implementada. O aviso vai para o log
(`NotificadorDeLog`) e quem chama o cliente é o maître. Avisar por mensagem depende de
contratar um serviço de terceiros — WhatsApp, SMS ou outro — e implementar `Notificador` com
ele, sem tocar no domínio: é para isso que a porta existe.

Se for ligar um provedor no Brasil, dois obstáculos que valem saber de antemão:

- SMS para números brasileiros exige registro prévio de sender ID junto às operadoras,
  com documentação e carta de autorização;
  [sender alfanumérico não funciona em conta de teste](https://support.twilio.com/hc/en-us/articles/223181348-Alphanumeric-Sender-ID-for-Twilio-Programmable-SMS)
  e tráfego não registrado costuma ser filtrado.
- WhatsApp trata como iniciada pela empresa toda mensagem que não seja resposta dentro de
  24h a uma mensagem do cliente, e exige
  [template pré-aprovado](https://www.twilio.com/docs/whatsapp/tutorial/send-whatsapp-notification-messages-templates)
  para essas. "Sua mesa está pronta" é exatamente esse caso, então o adaptador precisará
  mandar o identificador do template e as variáveis, não texto livre.

Vale para qualquer forma de avisar, não só mensagem: um painel de LED mostrando a vez da
fila é outra implementação de `Notificador`, ou uma tela a mais lendo `GET /fila`. A porta não
sabe se do outro lado há uma operadora ou um display na parede.

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
  http/            servidor, rotas, autenticação, erro → status
  compartilhado/   trava assíncrona, relógio injetável, log estruturado
  eventos.ts       o diário: o que aconteceu, em ordem
  main.ts          ponto de entrada do serviço
  demo.ts          roteiro de demonstração
  index.ts         superfície pública do pacote (só reexporta)
```

Quatro decisões explicam o resto:

Posição é planta, não regra. Mesa tem lugar no salão porque estabelecimento real tem
disposição de mesas, e quem opera precisa reconhecer "a mesa do canto" — `POST
/mesas/:id/posicao` move uma. Mas nenhuma regra de alocação usa posição: quem senta onde
continua sendo decidido por capacidade e ordem de chegada. Há teste fixando isso — a mesa
pequena no fundo vence a grande na entrada.

O agregado é o salão, não a mesa. Mesas e fila precisam mudar juntas para continuarem
coerentes — dar uma mesa a alguém é, no mesmo instante, tirá-lo da fila. Por isso a
consistência se define no salão inteiro, e é ele que se carrega e grava.

A transação é a unidade de atomicidade. `RepositorioDoSalao.transacao` recebe uma operação
síncrona, de propósito: assim nenhuma E/S entra no meio de uma decisão de alocação. No
SQLite é `BEGIN IMMEDIATE` com `ROLLBACK`; em memória é uma trava mais restauração do estado
se a operação lançar. As duas implementações rodam a mesma suíte de contrato
(`dominio/portas/contrato-do-repositorio.test.ts`) — é o que garante que trocar memória por
banco não muda o que o domínio pode esperar. A suíte cobre também o que o adaptador não
pode fazer: guardar a `Mesa` que recebeu, ou devolver o item vivo da fila. Um adaptador que
faça isso deixa o chamador mudar o salão fora da transação.

Leitura não é escrita. `consulta` é a mesma porta sem gravação: `BEGIN DEFERRED` no
SQLite, a trava sem fotografar o estado em memória. Enquanto todo `GET` passava por
`transacao`, uma leitura tomava a trava de escrita do banco e reescrevia as tabelas — dois
processos não conseguiam nem ler ao mesmo tempo. O `busy_timeout` do SQLite é 5s, e não o
zero padrão, que faz qualquer disputa falhar na hora.

O tempo é injetável. `Relogio` entra por construtor, então o tempo médio de espera é
testado sem esperar de verdade. Nenhum teste depende de `sleep`.

### Ferramental

O lint é o Biome, não ESLint: `typescript-eslint` exige TypeScript `<6.1` e este projeto
usa a versão 7, o port nativo — forçar instalaria um linter que depende de APIs internas do
compilador que mudaram. O Biome tem parser próprio e não depende da versão do TypeScript.

A regra `useLiteralKeys` está desligada: com `noUncheckedIndexedAccess`, acessar por colchete
(`process.env["PORTA"]`, `parametros["id"]`) sinaliza que a chave pode não existir, e o tipo
resultante inclui `undefined`. Trocar por ponto esconderia isso.

## Limitações conhecidas

- Autenticação é um token único da equipe, sem usuários nem papéis. Serve para API de
  retaguarda; uma API pública multiusuário precisa de credencial por pessoa.
- O repositório em memória serializa por processo; só o SQLite é seguro com mais de um
  processo escrevendo.
- Não há provedor de mensagem ligado. O aviso a quem sai da fila vai para o log; a porta
  `Notificador` está pronta para receber uma implementação de verdade.
- O aviso não tem outbox. Ele sai depois do commit, como deve; mas se o processo cair
  entre o commit e a chamada ao `Notificador`, a mesa fica alocada e ninguém é chamado — e
  nada no estado registra que o aviso ficou pendente. Com um provedor de verdade ligado, é a
  próxima peça a construir.
- Sem rate limiting: um cliente autenticado pode inundar a API.
- O diário nunca perde linhas. O expurgo anula nome e telefone dos eventos antigos, mas
  não apaga a linha — o relatório de meses atrás precisa dela. Num salão movimentado o arquivo
  cresce para sempre. A consulta é indexada por momento, então ler um período não degrada.
- Não há como voltar uma migração. Para desfazer, restaure uma cópia anterior à
  atualização. Migração reversa é código que quase nunca roda e quase nunca está certo quando
  roda.
- O painel atualiza por polling, quatro leituras a cada três segundos. Numa casa e num
  painel só isso é irrelevante; com muitos painéis abertos, o caminho é o servidor do painel
  empurrar as mudanças em vez de cada aba perguntar.
- Não dá para mudar número ou lugares de uma mesa que já existe, só pôr e tirar. Montar
  o salão errado custa apagar e refazer — o que não perde nada do diário, mas é chato.
- Sem `SALAO_BACKUP_ESPELHO` as cópias ficam no mesmo disco, e alguém tem de apontar o
  espelho: não há padrão seguro para adivinhar.
- Não há cópia no encerramento no Windows. Parar a tarefa no Agendador não entrega sinal
  nenhum ao Node, então o código de encerramento não roda. Quem cobre é a cópia periódica.
- Só Windows. Não há equivalente para Linux ou macOS; num Linux, `systemd --user` faria o
  mesmo papel.
- O CSV do diário para em 500 eventos, que é o teto de `/eventos`. Um dia cabe com folga;
  um intervalo longo não, e a tela avisa quantos ficaram de fora em vez de entregar um
  arquivo cortado em silêncio. Exportar período grande pede paginação, que não existe.
- A prévia da chegada é um retrato, não uma reserva. Entre ver "senta na mesa 3" e
  apertar o botão, a mesa pode ter ido para outro grupo — e aí quem recusa é o serviço, com
  o erro de sempre. É o comportamento certo, mas convém saber que a linha verde não promete
  nada.
