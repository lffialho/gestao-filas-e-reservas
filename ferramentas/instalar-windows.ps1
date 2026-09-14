#Requires -Version 5.1
<#
.SYNOPSIS
    Deixa o salão subindo sozinho na máquina do balcão.

.DESCRIPTION
    Registra duas tarefas agendadas no Windows — uma para o serviço, outra para
    o painel — que sobem ao entrar na conta e voltam sozinhas se o processo cair.

    Quem supervisiona é o próprio Windows, e não um script nosso: se ninguém
    estiver olhando às 21h de sábado, é o agendador que precisa levantar o
    serviço, e ele continua de pé mesmo que tudo o que escrevemos morra.

    Rode uma vez, na máquina onde o salão vai rodar, com o projeto já compilado
    (`npm run build` e `npm run web:build`) e o `.env` preenchido.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File ferramentas\instalar-windows.ps1
#>

$ErrorActionPreference = "Stop"

function Parar {
    param([string] $Mensagem)

    # `throw` imprimiria a linha do script e uma fileira de tis debaixo dela.
    # Quem está instalando precisa da frase, não do código que a produziu.
    Write-Host ""
    Write-Host $Mensagem -ForegroundColor Red
    exit 1
}

$raiz = Split-Path -Parent $PSScriptRoot
$env_ = Join-Path $raiz ".env"
$servico = Join-Path $raiz "dist\main.js"
$painel = Join-Path $raiz "web\dist\servidor.js"

Write-Host "Salão em: $raiz"

# ---------------------------------------------------------------- conferências
# Falhar aqui, com a mensagem certa, é muito melhor do que registrar tarefas que
# não sobem e descobrir isso no dia seguinte.

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    Parar "Não achei o node no PATH. Instale o Node.js 22 ou mais novo e rode de novo."
}
$versao = (& $node --version).TrimStart("v").Split(".")[0]
if ([int]$versao -lt 22) {
    Parar "Node $versao é antigo demais; o projeto usa node:sqlite, que pede a versão 22 ou mais nova."
}
Write-Host "Node: $node (v$versao)"

foreach ($arquivo in @($servico, $painel)) {
    if (-not (Test-Path $arquivo)) {
        Parar "Não achei $arquivo. Rode 'npm run build' e 'npm run web:build' antes."
    }
}

if (-not (Test-Path $env_)) {
    Parar "Não achei o .env em $raiz. Copie o .env.example, preencha o SALAO_TOKEN e rode de novo."
}
if (-not (Select-String -Path $env_ -Pattern '^\s*SALAO_TOKEN\s*=\s*\S' -Quiet)) {
    Parar "O .env não tem SALAO_TOKEN preenchido. Sem token o serviço se recusa a subir, e é para se recusar mesmo."
}

# ------------------------------------------------------------------- tarefas
# Dois gatilhos, e não um.
#
# `-AtLogOn` sobe o salão ao entrar na conta. `RestartCount` cobre o processo que
# *falha*. Mas já vimos aqui um caso que escapa aos dois: o node encerrado por
# evento de console (saída 0xC000013A) deixou a tarefa em "Ready", sem falha para
# reiniciar, e o serviço ficou fora do ar sem ninguém perceber. Numa casa que abre
# todo dia, "não percebi" é o mesmo que "não funciona".
#
# Por isso o segundo gatilho: uma repetição a cada dois minutos, para sempre.
# Junto com `-MultipleInstances IgnoreNew`, ele não faz nada enquanto o serviço
# está de pé, e o levanta em no máximo dois minutos morra como morrer. É o
# agendador do Windows vigiando, que é o que continua existindo depois que todo
# processo nosso morreu.

$REPETICAO_EM_MINUTOS = 2

function Instalar-Tarefa {
    param(
        [string] $Nome,
        [string] $Script,
        [string] $Descricao
    )

    $acao = New-ScheduledTaskAction `
        -Execute $node `
        -Argument "--env-file=`"$env_`" `"$Script`"" `
        -WorkingDirectory $raiz

    $gatilhos = @(
        (New-ScheduledTaskTrigger -AtLogOn),
        # Sem `-RepetitionDuration`: duração vazia é como o Agendador escreve
        # "para sempre". Passar um TimeSpan enorme parece a mesma coisa e não é —
        # o registro é recusado com "valor fora do intervalo", e a tarefa não
        # chega a existir.
        (New-ScheduledTaskTrigger `
                -Once `
                -At (Get-Date).Date `
                -RepetitionInterval (New-TimeSpan -Minutes $REPETICAO_EM_MINUTOS))
    )

    $ajustes = New-ScheduledTaskSettingsSet `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -StartWhenAvailable `
        -MultipleInstances IgnoreNew `
        -RestartCount 999 `
        -RestartInterval (New-TimeSpan -Minutes 1) `
        -ExecutionTimeLimit (New-TimeSpan -Seconds 0)

    # Idempotente: rodar de novo atualiza em vez de duplicar.
    Unregister-ScheduledTask -TaskName $Nome -Confirm:$false -ErrorAction SilentlyContinue

    Register-ScheduledTask `
        -TaskName $Nome `
        -Description $Descricao `
        -Action $acao `
        -Trigger $gatilhos `
        -Settings $ajustes `
        -RunLevel Limited | Out-Null

    Start-ScheduledTask -TaskName $Nome
    Write-Host "Tarefa registrada e iniciada: $Nome"
}

Instalar-Tarefa -Nome "Salao - servico" -Script $servico `
    -Descricao "Serviço de filas e reservas. Sobe ao entrar na conta e volta sozinho se cair."

Instalar-Tarefa -Nome "Salao - painel" -Script $painel `
    -Descricao "Painel do maître. Sobe ao entrar na conta e volta sozinho se cair."

# --------------------------------------------------------------------- resumo
Start-Sleep -Seconds 2

$portaWeb = 5173
$linha = Select-String -Path $env_ -Pattern '^\s*PORTA_WEB\s*=\s*(\d+)' | Select-Object -First 1
if ($linha) { $portaWeb = $linha.Matches[0].Groups[1].Value }

$banco = Select-String -Path $env_ -Pattern '^\s*SALAO_BANCO\s*=\s*(.+)$' | Select-Object -First 1

Write-Host ""
Write-Host "Pronto." -ForegroundColor Green
Write-Host "  Painel:  http://localhost:$portaWeb"
if ($banco) {
    $caminhoBanco = $banco.Matches[0].Groups[1].Value.Trim()
    Write-Host "  Banco:   $caminhoBanco"
    Write-Host "  Cópias:  na pasta 'backups' ao lado do banco"
    Write-Host ""
    Write-Host "  Aponte um OneDrive, um Google Drive ou um pendrive para a pasta das cópias:" -ForegroundColor Yellow
    Write-Host "  cópia no mesmo disco não protege contra o disco morrer." -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "  ATENÇÃO: o .env não define SALAO_BANCO." -ForegroundColor Red
    Write-Host "  Sem ele o salão roda em memória e perde tudo ao reiniciar." -ForegroundColor Red
}
Write-Host ""
Write-Host "  Para acompanhar:  Agendador de Tarefas > 'Salao - servico'"
Write-Host "  Para remover:     ferramentas\desinstalar-windows.ps1"
