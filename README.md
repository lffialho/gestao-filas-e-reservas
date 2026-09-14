# Gestão de filas e reservas

Backend para atendimento de salão de restaurante **por ordem de chegada**. Não há hora
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
| `npm run tudo:env` | Sobe **serviço e painel juntos**, lendo o `.env`, e levanta de novo o que cair |
| `npm test` | 296 testes |
| `npm run typecheck` | Só os tipos |
| `npm run lint` | Biome: lint e formatação |
| `npm run format` | Aplica as correções seguras do Biome |
| `npm run verificar` | lint + typecheck + testes + build, o que o CI roda |
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
| `PORTA_WEB` | `5173` | Porta do painel, que roda num processo próprio |
| `SALAO_API` | `http://127.0.0.1:3000` | Onde o painel procura a API |
| `PAINEL_SENHA` | — | Senha do painel. Sem ela o painel se recusa a subir |
| `PAINEL_SEM_SENHA` | — | `1` abre o painel a quem alcançar a porta. Só para desenvolvimento |

A porta do serviço aparece em duas variáveis — `PORTA`, para ele, e `SALAO_API`, para o
painel achá-lo — e o `.env.example` já traz as duas preenchidas. **Mudar uma sem mudar a
outra** deixa o painel batendo numa porta vazia: ele sobe, a tela abre e nada carrega.
`npm run tudo` confere isso antes de subir e recusa com a mensagem certa; `npm start` e
`npm run web`, rodados separados, não têm como conferir.

Bancos criados por versões anteriores são atualizados sozinhos na primeira
abertura: a tabela `esperas`, que guardava uma linha por atendimento, vira um
resumo de uma linha só, com o mesmo tempo médio.

**O serviço não sobe sem `SALAO_TOKEN`.** Uma API que opera o salão aberta por omissão é o
tipo de padrão que só se descobre errado depois; abrir tem de ser escolha declarada, via
`SALAO_SEM_AUTENTICACAO=1`.

O jeito recomendado é pôr tudo no `.env` e usar `npm run start:env`. O arquivo fica fora do
git, e o comando é o mesmo em qualquer sistema.

## Instalar na máquina do balcão

Rodar na mão, com `npm run tudo:env`, serve para testar. Numa casa que abre todo dia o salão
tem de subir sozinho ao ligar o computador e voltar sozinho se cair — às 21h de sábado não
há ninguém olhando para o terminal.

```powershell
npm install
npm run build
npm run web:build
Copy-Item .env.example .env     # preencha SALAO_TOKEN e SALAO_BANCO
powershell -ExecutionPolicy Bypass -File ferramentas\instalar-windows.ps1
```

**Rode num PowerShell como administrador.** Tarefas na raiz do Agendador exigem elevação para
serem criadas ou trocadas, e sem isso o script para na hora de registrar.

O script confere o que precisa estar pronto — Node 22 ou mais novo, os dois builds, o `.env`
com token — e só então registra duas tarefas no Agendador do Windows, uma para o serviço e
outra para o painel. Quem supervisiona é o próprio Windows, e não um script nosso: se ninguém
estiver olhando, é o agendador que precisa levantar o serviço, e ele continua de pé mesmo que
tudo o que escrevemos morra. Rodar de novo atualiza em vez de duplicar.

Cada tarefa tem **dois gatilhos**, e a diferença importa. O primeiro sobe o salão ao entrar na
conta. O segundo repete a cada dois minutos, para sempre, e é o que garante que ele volte.

A razão é medida, não teórica. Com só o reinício-em-falha do Agendador (`RestartCount`), matar
o processo do serviço deixou a tarefa parada em "Ready" e **o salão ficou fora do ar por 150
segundos sem nenhuma tentativa de subir** — até ser levantado à mão. Reinício-em-falha cobre a
tarefa que falha, não o processo que some.

Com os dois gatilhos, o mesmo teste — matar o `node` do serviço e não tocar em mais nada —
**trouxe o salão de volta sozinho em 123 segundos**, dentro da janela de dois minutos. Com
`MultipleInstances = IgnoreNew` a repetição não faz nada enquanto o serviço está de pé.

Vale repetir esse teste depois de instalar, em cada casa: mate o `node` do serviço e confira
que `http://localhost:3000/saude` volta a responder em até dois minutos. É o teste que separa
"deve voltar sozinho" de "volta sozinho".

`ferramentas\desinstalar-windows.ps1` tira as tarefas e **não toca no banco nem nas cópias**
— desinstalar não pode ser o comando que apaga o histórico do restaurante.

### As cópias do banco

O estado do salão é o registro operacional da casa num arquivo só. Uma cópia é gravada ao
subir e a cada seis horas, na pasta `backups/` ao lado do banco. Sai por
`VACUUM INTO`, que é a forma que o próprio SQLite dá para copiar um banco **em uso**: a cópia
vem de uma leitura transacional e nunca contém metade de uma operação. Copiar o `.db` por
fora, com `Copy-Item`, pode pegá-lo no meio de uma escrita e gerar um arquivo que não abre —
e seria justamente no sábado cheio que isso aconteceria.

**Uma cópia no mesmo disco não protege contra o disco morrer.** Ela cobre corrupção, engano
e erro de operação, que é a maioria dos casos. Para o resto, aponte um OneDrive, um Google
Drive ou um pendrive para a pasta das cópias: são arquivos comuns, qualquer sincronismo
serve, e isso é o que transforma cópia local em backup de verdade.

O serviço ainda tenta uma última cópia ao encerrar, mas **não conte com ela no Windows**:
parar a tarefa no Agendador encerra o processo sem entregar sinal nenhum, e o código de
encerramento não chega a rodar. Quem garante é a cópia periódica. Na prática: a cópia mais
recente pode ser de até seis horas atrás, e é por isso que o intervalo é a variável que
vale a pena mexer (`SALAO_BACKUP_HORAS`) numa casa de movimento.

### Restaurar

Backup que nunca foi restaurado não é backup: é um arquivo que se espera que sirva. Por isso
restaurar é um script, e não um parágrafo de instruções para seguir na pior noite possível.

```powershell
powershell -ExecutionPolicy Bypass -File ferramentas\restaurar-windows.ps1 -Ensaio
```

`-Ensaio` mostra o que ele faria e não altera nada — rode assim uma vez, hoje, para saber que
funciona. Sem `-Ensaio`, ele lista as cópias (a mais nova primeiro), pergunta qual, e então:

1. **confere a cópia antes de tocar no banco atual** — nunca se troca um banco que funciona
   por uma cópia que não abre;
2. para as tarefas do Windows e espera o arquivo ser solto, porque aqui o arquivo fica preso
   enquanto o processo o tiver aberto;
3. **guarda o banco atual, nunca apaga** — junto com o `-wal` e o `-shm`, numa pasta com a
   data. Restaurar a cópia errada é um engano possível, e não pode ser um engano definitivo;
4. copia, confere de novo o arquivo que ficou no lugar, e sobe o serviço.

Para conferir uma cópia sem restaurar nada — vale a pena de vez em quando:

```bash
node ferramentas/conferir-copia.mjs backups/salao-2026-09-14T19-11-37-984Z.db
```

Ele abre só para leitura, roda `integrity_check` no banco inteiro, exige as tabelas do salão e
mostra quantas mesas, quantos na fila e quantos eventos há ali — porque a cópia de um salão
vazio abre perfeitamente, e é o engano caro de não perceber na hora de restaurar.

## API

Autentique com `Authorization: Bearer <SALAO_TOKEN>` (ou `X-API-Key`). O nome do esquema é
case-insensitive, como manda a RFC 7235; o token, não. `/saude` fica aberta, para health
check — e `HEAD` funciona em toda rota que aceita `GET`.

Parâmetros de caminho são percent-decodificados: um telefone em E.164 vai como
`/fila/%2B5511999999999`.

| Método | Rota | O que faz |
| --- | --- | --- |
| `GET` | `/saude` | Sinal de vida. Sem token |
| `GET` | `/salao` | Retrato de agora: ocupação, tempo médio de espera, fila e mesas |
| `GET` | `/relatorio` | Fechamento de um período — `?de=<ISO>&ate=<ISO>` |
| `GET` | `/eventos` | O diário cru do período — `?de=<ISO>&ate=<ISO>&limite=<1..500>` |
| `POST` | `/mesas` | Cadastra mesa — `{ id, numero, capacidade }`. Se alguém na fila couber nela, já nasce reservada |
| `GET` | `/mesas/:id` | Estado da mesa e quem a ocupa |
| `DELETE` | `/mesas/:id` | Tira a mesa da planta. Mesa ocupada ou já chamada não sai |
| `POST` | `/chegadas` | **Cliente chegou** — `{ nome, pessoas, telefone }`. O salão decide entre mesa e fila |
| `GET` | `/chegadas/previa` | Onde esse grupo iria parar, sem mudar nada — `?pessoas=N&telefone=<opcional>` |
| `DELETE` | `/fila/:telefone` | Desistência: sai da fila |
| `POST` | `/mesas/:id/reserva` | O anfitrião senta alguém numa mesa escolhida a dedo |
| `DELETE` | `/mesas/:id/reserva` | Cancela a reserva; a mesa vai para o próximo da fila que couber |
| `POST` | `/mesas/:id/ocupacao` | O grupo chegou à mesa e sentou |
| `POST` | `/mesas/:id/liberacao` | O grupo foi embora; a mesa vai para o próximo da fila que couber |
| `GET` | `/fila` | Quem está esperando, na ordem de chegada |
| `POST` | `/mesas/:id/posicao` | Arrasta a mesa na planta — `{ coluna, linha }` |

`POST /chegadas` é a porta de entrada normal. `POST /mesas/:id/reserva` existe para o
anfitrião escolher a mesa, e **continua respeitando a ordem de chegada**: se alguém na fila
cabe naquela mesa, só ele pode recebê-la — e quem senta é o cliente que já estava na fila,
com a hora de chegada dele. Se o nome ou o tamanho do grupo do pedido não baterem com o que
está na fila, a resposta é `409 IdentidadeDivergente` em vez de uma troca silenciosa.

**Toda mesa diz desde quando.** O campo `desde` marca o instante em que a mesa entrou no
status atual, e muda só nas transições — arrastar a mesa na planta não faz o grupo sentar de
novo. É daí que saem duas coisas que o status sozinho não responde: há quanto tempo o grupo
está na mesa, e há quanto tempo quem foi chamado ainda não apareceu. Bancos de versões
anteriores ganham a coluna na primeira abertura, contando a partir da migração — não há como
descobrir depois quando cada mesa entrou no status em que está.

**O diário diz o que aconteceu.** O estado responde como o salão está agora; nenhuma
pergunta sobre o passado — maior espera da noite, pico da fila, quantas vezes cada mesa
girou — cabe nele. Por isso cada operação também deixa eventos, e o repositório os grava **na
mesma transação** do estado: evento escrito depois sobreviveria a um rollback, e o relatório
passaria a contar atendimento que não houve.

`GET /relatorio?de=…&ate=…` resume um período. As bordas vêm em ISO de quem chama, porque só
o cliente sabe onde começa "hoje" no fuso do restaurante. Dois números pedem leitura atenta:
a **espera média** é de quem passou pela fila — juntar os zeros de quem sentou direto mediria
o quanto o salão estava vazio, não quanto se espera quando há espera; e o **pico da fila**
conta a partir de zero no começo do período, sem saber quantos já aguardavam antes dele.

`GET /eventos?de=…&ate=…` devolve os mesmos fatos sem somar nada, do mais recente para o mais
antigo, com `{ itens, total }`. São perguntas diferentes: o resumo responde "como foi a
noite", o diário responde "o que acabou de acontecer". `limite` corta a resposta, não a
leitura — o período é lido inteiro de qualquer jeito, e o corte existe para o painel não
arrastar o dia todo a cada atualização; por isso `total` conta o período, não a fatia.

**O telefone é a identidade.** O mesmo número não pode estar em duas mesas, nem sentado e na
fila ao mesmo tempo — é por ele que se desiste da fila e é para ele que o aviso de mesa
pronta vai.

`GET /chegadas/previa?pessoas=…` responde **o que aconteceria** se esse grupo chegasse agora:
`{ destino: "mesa" | "fila" | "recusa", mesa, posicao, motivo }`. É leitura pura — nada muda
no salão — e chama exatamente o mesmo cálculo que `POST /chegadas` faria, inclusive a regra
de que uma mesa livre não serve se alguém que já espera também caberia nela. Existe para o
painel poder mostrar o destino a quem ainda está digitando **sem uma segunda cópia da regra
na tela**: duas cópias divergem, e a tela passaria a prometer mesa que o salão não daria. Na
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

Dois processos, de propósito. **O painel existe por causa do token**: `SALAO_TOKEN` é segredo
único da equipe, e em JavaScript de navegador qualquer um que abra o devtools libera todas as
mesas do salão. Então `web/servidor` guarda o token, serve `web/publico/` e repassa `/api/...`
para o serviço pondo o cabeçalho ali. O `Authorization` que chega do navegador é descartado —
quem fala com o serviço não escolhe a credencial.

### A senha do painel

Esconder o token do navegador cria a outra ponta do problema, e ela não é óbvia: **como é o
painel que carrega a credencial, quem alcança o painel manda no salão** — sem token nenhum. E
o painel escuta na rede de propósito, que é como o tablet do balcão o abre. Sem senha,
qualquer um no wifi do restaurante abre `http://<ip-do-balcão>:5173` e senta gente, libera
mesa, tira mesa da planta e fecha o dia.

Daí `PAINEL_SENHA`, que é segredo de papel diferente do token: o token é o que o painel usa
para falar com o serviço; a senha é o que uma pessoa usa para falar com o painel. **O painel
se recusa a subir sem ela** — em desenvolvimento, `PAINEL_SEM_SENHA=1` abre, e a linha de
subida diz em voz alta que está aberto.

Pedida uma vez a cada 12 horas, que é um turno. A sessão é um cookie `HttpOnly`,
`SameSite=Strict`, assinado com HMAC-SHA256 por uma chave **derivada da própria senha** — o
que tem duas consequências boas: não há mais um segredo para configurar em cada casa, e a
sessão sobrevive ao painel reiniciar, então ninguém é deslogado quando o Agendador levanta o
processo no meio do sábado. Trocar a senha invalida as sessões abertas, que é o que se espera
ao trocar uma senha. `/sair` encerra a sessão.

Enquanto não autenticado, **nada de `publico/` é servido** — nem o CSS, nem o JS: tudo
redireciona para `/entrar`, e `/api/...` responde `401` em JSON, para o painel saber pedir a
senha em vez de mostrar "erro desconhecido". A tela de entrada é HTML autocontido, sem
depender de nenhum arquivo protegido.

Uma senha errada custa 400 ms e sai no log. Não é proteção contra força bruta de verdade —
para isso a senha precisa ser boa. **Uma senha por instalação**, e nunca a mesma em todas as
casas:

```bash
node -e "console.log(require('node:crypto').randomBytes(9).toString('base64url'))"
```

O cookie não é `Secure`, porque o painel roda em `http://` na rede local e um cookie `Secure`
simplesmente não seria mandado. Consequência: quem consegue ler o tráfego daquela rede lê o
cookie. Numa rede de balcão é aceitável; numa rede compartilhada com os clientes, o certo é
separar a rede — não é problema que senha nenhuma resolva.

```
web/
  servidor/    node:http — estáticos e repasse autenticado
  navegador/   TypeScript do painel, compilado para publico/js/
    api.ts       cliente da API, com os tipos do que viaja no fio
    tempo.ts     o fuso do restaurante e os formatos de hora
    relogios.ts  o tique de um segundo que reescreve as contagens
    planta.ts    a planta: vãos, lugares e colisões
    fila.ts      a tira da fila
    diario.ts    fato do diário → frase
    fechamento.ts  os números do dia
    chegada.ts   o formulário de quem chegou, com a prévia
    csv.ts       CSV que abre no Excel em português
    modal.ts     a janela de ação
    dom.ts       montagem de DOM sem innerHTML
    painel.ts    estado, atualização e regiões — entra por app.ts
    tela-fechamento.ts  a tela do fechamento — entra por fechamento.html
  publico/     index.html, fechamento.html, estilo.css e o JavaScript gerado
```

Duas páginas, dois pontos de entrada, um CSS. `tempo.ts` e `csv.ts` têm teste — rodam sob
`node --test` como o resto da suíte, porque não tocam em DOM nenhum: é aritmética de fuso e
escape de texto, e isso se testa sem navegador. Os testes ficam fora do que vai para
`publico/js/` (o `exclude` do `tsconfig.navegador.json`) e são verificados pelo
`tsconfig.testes.json`, que é o único a lhes dar os tipos do node.

Sem bundler e sem dependência: o `tsc` que já está aqui compila os dois lados, e o navegador
carrega os módulos nativamente. `web/dist/` e `web/publico/js/` são gerados e ficam fora do
git. A única coisa que vem de fora são as fontes (Google Fonts); sem internet o painel cai
nas fontes do sistema e continua inteiro.

### O que está na tela

A **planta** é a grade 12 × 9 do domínio com as mesas por cima. Verde é livre, âmbar é
chamada, vermelho é ocupada — e nada mais no painel usa essas três cores, para que não
percam o sentido. As bolinhas em volta são os lugares: dá para contar as cadeiras e ver que
sobram duas na mesa de quatro. Ao lado, quatro números (ocupação, maior mesa livre, espera
média, fila), o diário do dia e, embaixo, a fila — com o próximo aberto por inteiro e o resto
resumido, porque num salão de quarenta mesas ninguém opera lendo trinta cartões.

Clicar numa mesa abre o que dá para fazer com ela: *sentou*, *devolver para a fila*, *liberou
a mesa*. O que tira a mesa de alguém pede um segundo toque. Clicar em quem espera oferece
tirá-lo da fila. A resposta do serviço vira frase — "Mesa 3 liberada e chamada para Ana" —
em vez de mandar conferir na tela.

Em **Chegou alguém**, enquanto se digita, uma linha diz onde o grupo vai parar: "Senta na
mesa 3", "Entra na fila, na posição 2", "Este telefone já está na mesa 3". Essa resposta vem
de `GET /chegadas/previa`, não de um cálculo aqui — a razão está na seção da API. O botão
continua valendo mesmo quando a prévia recusa: a prévia é um retrato de alguns segundos
atrás, e quem decide de verdade é o serviço, no momento do envio.

### Montar o salão

**Montar salão** liga um modo à parte, e é à parte de propósito: quem opera clica em mesa a
noite inteira para sentar e liberar gente, e se arrastar também mexesse na planta um dedo
escorregando no tablet mudaria o salão no meio do movimento. Ligado o modo, a planta muda de
cara, clicar não senta ninguém, e dá para:

- **pôr mesa** — número já sugerido no menor livre, lugares, e ela entra no primeiro espaço
  vago da planta;
- **arrastar** para o lugar dela, com o dedo ou o mouse, encaixando no ladrilho;
- **tirar da planta** — só mesa livre. Mesa ocupada, ou já chamada para alguém que está a
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

O período é **hoje**, **ontem** ou um **intervalo** de datas. Como os números saem do diário,
e não do estado do salão, pedir ontem funciona e o relatório sobrevive a um reinício do
serviço no meio do expediente.

Dois arquivos saem em CSV, com `;` e BOM porque é o que abre certo no Excel em português (a
razão está em `csv.ts`):

- **o resumo** — os indicadores do período e a tabela por mesa, duas tabelas separadas por
  uma linha em branco no mesmo arquivo, que é como se olha a noite inteira de uma vez;
- **o diário** — um evento por linha, com o momento em ISO e a hora legível ao lado.
  **Sem telefone**: este arquivo sai do salão, e o relatório do dia não precisa levar junto
  uma lista de contatos de clientes para ser útil.

**A mesa chamada tem prazo.** `RESERVADA` já significa "chamada, ainda não sentou", e o
`desde` diz desde quando; o painel conta cinco minutos a partir daí e, quando estouram,
marca a mesa. Só marca: quem devolve a mesa é o maître, nunca o relógio — quem foi chamado
pode estar estacionando o carro, e um cancelamento automático daria a mesa dessa pessoa para
outra sem ninguém ter olhado.

**Desenho por região.** A tela se atualiza sozinha a cada três segundos, e o que a
atualização substitui é só o que veio do serviço: planta, números, diário e fila. A caixa de
busca e a janela de ação ficam de fora — um painel que apagasse o nome sendo digitado, ou que
fechasse a janela no meio de uma decisão, perderia a confiança de quem opera em um
expediente. Pela mesma razão os cliques são ouvidos nos contêineres, e não nos cartões: os
cartões são trocados, os contêineres não. E as contagens regressivas correm num tique local
de um segundo que só reescreve texto, para não ficarem tremendo junto com a rede.

Sem contato com o serviço, o último retrato **fica na tela** com um aviso dizendo de quando
ele é. Num salão cheio, o estado conhecido de um minuto atrás vale mais do que uma tela em
branco.

**O fuso do restaurante mora no painel**, em `web/navegador/tempo.ts` — hoje
`America/Sao_Paulo`. O serviço trabalha com instantes, e instante não tem fuso; "hoje" tem, e
quem sabe onde começa o dia é quem opera o salão. Fixar no painel também é mais correto do que
usar o fuso do aparelho: o tablet do balcão pode estar configurado de qualquer jeito, e o
relatório do dia não pode depender disso.

**A posição do domínio é um ladrilho**; o vão de vários ladrilhos que cada mesa ocupa na tela
é invenção do painel. Daí vem o único caso curioso: duas mesas a um ladrilho de distância são
legais no domínio e se cobririam no desenho. Quando isso acontece, a de número menor fica
onde está e a outra vai para o primeiro vão livre — mesa desenhada em outro canto ainda se
lê, duas mesas empilhadas não se leem nenhuma.

Nome de cliente é texto que alguém digitou no balcão, então nada no painel entra por
`innerHTML`: todo texto vai por `textContent`, e o que vem da API nunca vira marcação.

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
  http/            servidor, rotas, autenticação, erro → status
  compartilhado/   trava assíncrona, relógio injetável, log estruturado
  eventos.ts       o diário: o que aconteceu, em ordem
  main.ts          ponto de entrada do serviço
  demo.ts          roteiro de demonstração
  index.ts         superfície pública do pacote (só reexporta)
```

Quatro decisões explicam o resto:

**Posição é planta, não regra.** Mesa tem lugar no salão porque estabelecimento real tem
disposição de mesas, e quem opera precisa reconhecer "a mesa do canto" — `POST
/mesas/:id/posicao` move uma. Mas nenhuma regra de alocação usa posição: quem senta onde
continua sendo decidido por capacidade e ordem de chegada. Há teste fixando isso — a mesa
pequena no fundo vence a grande na entrada.

**O agregado é o salão, não a mesa.** Mesas e fila precisam mudar juntas para continuarem
coerentes — dar uma mesa a alguém é, no mesmo instante, tirá-lo da fila. Por isso a
consistência se define no salão inteiro, e é ele que se carrega e grava.

**A transação é a unidade de atomicidade.** `RepositorioDoSalao.transacao` recebe uma operação
**síncrona**, de propósito: assim nenhuma E/S entra no meio de uma decisão de alocação. No
SQLite é `BEGIN IMMEDIATE` com `ROLLBACK`; em memória é uma trava mais restauração do estado
se a operação lançar. As duas implementações rodam a **mesma suíte de contrato**
(`dominio/portas/contrato-do-repositorio.test.ts`) — é o que garante que trocar memória por
banco não muda o que o domínio pode esperar. A suíte cobre também o que o adaptador **não**
pode fazer: guardar a `Mesa` que recebeu, ou devolver o item vivo da fila. Um adaptador que
faça isso deixa o chamador mudar o salão fora da transação.

**Leitura não é escrita.** `consulta` é a mesma porta sem gravação: `BEGIN DEFERRED` no
SQLite, a trava sem fotografar o estado em memória. Enquanto todo `GET` passava por
`transacao`, uma leitura tomava a trava de escrita do banco e reescrevia as tabelas — dois
processos não conseguiam nem ler ao mesmo tempo. O `busy_timeout` do SQLite é 5s, e não o
zero padrão, que faz qualquer disputa falhar na hora.

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
- **O aviso não tem outbox.** Ele sai depois do commit, como deve; mas se o processo cair
  entre o commit e a chamada ao `Notificador`, a mesa fica alocada e ninguém é chamado — e
  nada no estado registra que o aviso ficou pendente. Com um provedor de verdade ligado, é a
  próxima peça a construir.
- Sem rate limiting: um cliente autenticado pode inundar a API.
- **O diário só cresce.** Não há expurgo nem arquivamento: um salão movimentado acumula
  eventos para sempre. A consulta é indexada por momento, então a leitura de um período não
  degrada, mas o arquivo sim.
- Sem migrações versionadas. Há duas migrações pontuais — a tabela `esperas` antiga virando
  resumo, e a coluna `desde` das mesas —, mas não um mecanismo geral para mudanças futuras.
- **O painel atualiza por polling**, quatro leituras a cada três segundos. Numa casa e num
  painel só isso é irrelevante; com muitos painéis abertos, o caminho é o servidor do painel
  empurrar as mudanças em vez de cada aba perguntar.
- **Não dá para mudar número ou lugares de uma mesa que já existe**, só pôr e tirar. Montar
  o salão errado custa apagar e refazer — o que não perde nada do diário, mas é chato.
- **As cópias do banco ficam no mesmo disco** e não protegem contra o disco morrer. Sincronizar
  a pasta para fora resolve, e é manual.
- **Não há cópia no encerramento quando o Windows encerra o processo à força**, que é o
  caso normal: parar a tarefa no Agendador não entrega sinal nenhum ao Node. Medido —
  `SIGTERM` e `SIGINT` matam sem passar pelo código de encerramento, `SIGBREAK` e `SIGHUP`
  nem matam. A cópia periódica cobre o buraco; a mais recente pode ser de até seis horas
  atrás.
- **A duração da repetição não pode ser um `TimeSpan` enorme.** `[TimeSpan]::MaxValue` cria o
  gatilho sem reclamar e o Agendador **recusa o registro** com "valor fora do intervalo".
  Duração vazia é como ele escreve "para sempre". Fica anotado porque o erro só aparece no
  registro, e o script desregistra a tarefa antes de registrar a nova.
- **Só Windows.** Não há equivalente para Linux ou macOS; num Linux, `systemd --user` faria o
  mesmo papel.
- **O CSV do diário para em 500 eventos**, que é o teto de `/eventos`. Um dia cabe com folga;
  um intervalo longo não, e a tela avisa quantos ficaram de fora em vez de entregar um
  arquivo cortado em silêncio. Exportar período grande pede paginação, que não existe.
- **A prévia da chegada é um retrato**, não uma reserva. Entre ver "senta na mesa 3" e
  apertar o botão, a mesa pode ter ido para outro grupo — e aí quem recusa é o serviço, com
  o erro de sempre. É o comportamento certo, mas convém saber que a linha verde não promete
  nada.
