#Requires -Version 5.1
<#
.SYNOPSIS
    Põe uma cópia do banco no lugar do banco atual.

.DESCRIPTION
    Backup que nunca foi restaurado não é backup: é um arquivo que se espera que
    sirva. Este script existe para que restaurar seja um procedimento ensaiado, e
    não algo improvisado na pior noite possível.

    O que ele garante, nesta ordem:

      1. a cópia escolhida abre e é um banco do salão — nunca se troca um banco
         bom por uma cópia que não presta;
      2. o serviço para antes, porque no Windows o arquivo fica preso enquanto
         o processo o tiver aberto;
      3. o banco atual é **guardado**, nunca apagado. Restaurar a cópia errada é
         um engano possível, e ele não pode ser um engano definitivo;
      4. o serviço volta.

.PARAMETER Copia
    Nome ou caminho da cópia. Sem isto, o script lista o que existe e pergunta.

.PARAMETER Banco
    Caminho do banco a substituir. Sem isto, sai do SALAO_BANCO do .env.

.PARAMETER Ensaio
    Mostra o que faria e não mexe em nada. Use antes da primeira vez de verdade.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File ferramentas\restaurar-windows.ps1 -Ensaio

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File ferramentas\restaurar-windows.ps1 -Copia salao-2026-09-14T19-11-37-984Z.db
#>

param(
    [string] $Copia,
    [string] $Banco,
    [switch] $Ensaio
)

$ErrorActionPreference = "Stop"

function Parar {
    param([string] $Mensagem)

    # `throw` imprimiria a linha do script e uma fileira de tis debaixo dela.
    # Quem está restaurando precisa da frase, não do código que a produziu.
    Write-Host ""
    Write-Host $Mensagem -ForegroundColor Red
    exit 1
}

$raiz = Split-Path -Parent $PSScriptRoot
$env_ = Join-Path $raiz ".env"
$TAREFAS = @("Salao - servico", "Salao - painel")

function Ler-Env {
    param([string] $Chave)
    if (-not (Test-Path $env_)) { return $null }
    $linha = Select-String -Path $env_ -Pattern "^\s*$Chave\s*=\s*(.+)$" | Select-Object -First 1
    if (-not $linha) { return $null }
    $valor = $linha.Matches[0].Groups[1].Value.Trim()
    if ($valor -eq "") { return $null } else { return $valor }
}

# ------------------------------------------------------------------- o alvo
# O banco do .env é o que o serviço instalado usa. Restaurar outro arquivo é
# legítimo (uma cópia de teste, um banco de outra casa), e nesse caso não há
# motivo para mexer no serviço: ele não segura um arquivo que não é o dele.

$bancoDoEnv = Ler-Env "SALAO_BANCO"
if (-not $Banco) {
    if (-not $bancoDoEnv) {
        Parar "O .env não define SALAO_BANCO e você não passou -Banco. Não sei que arquivo restaurar."
    }
    $Banco = $bancoDoEnv
}

# Relativo no .env é relativo à raiz do projeto, que é de onde o serviço roda.
$alvo = if ([System.IO.Path]::IsPathRooted($Banco)) { $Banco } else { Join-Path $raiz $Banco }
$alvo = [System.IO.Path]::GetFullPath($alvo)

$eOBancoDoServico = $false
if ($bancoDoEnv) {
    $doServico = if ([System.IO.Path]::IsPathRooted($bancoDoEnv)) { $bancoDoEnv } else { Join-Path $raiz $bancoDoEnv }
    $eOBancoDoServico = ([System.IO.Path]::GetFullPath($doServico) -eq $alvo)
}

$pasta = Ler-Env "SALAO_BACKUP_PASTA"
if (-not $pasta) { $pasta = Join-Path (Split-Path -Parent $alvo) "backups" }
if (-not (Test-Path $pasta)) { Parar "Não achei a pasta das cópias em $pasta." }

Write-Host "Banco a substituir: $alvo"
Write-Host "Cópias em:          $pasta"
if ($Ensaio) { Write-Host "ENSAIO: nada será alterado." -ForegroundColor Yellow }
Write-Host ""

# ---------------------------------------------------------------- a escolha
# Da mais nova para a mais antiga: quem restaura quase sempre quer a última boa,
# e deixá-la no topo evita escolher a errada por descuido.

$copias = @(Get-ChildItem -Path $pasta -Filter "salao-*.db" -File | Sort-Object Name -Descending)
if ($copias.Count -eq 0) { Parar "Não há nenhuma cópia em $pasta." }

if ($Copia) {
    $escolhida = $copias | Where-Object { $_.Name -eq $Copia } | Select-Object -First 1
    if (-not $escolhida -and (Test-Path $Copia)) { $escolhida = Get-Item $Copia }
    if (-not $escolhida) { Parar "Não achei a cópia '$Copia' em $pasta." }
} else {
    Write-Host "Cópias disponíveis (a mais nova primeiro):"
    for ($i = 0; $i -lt $copias.Count; $i++) {
        $c = $copias[$i]
        "{0,3}) {1}  {2,8:N0} KB  {3}" -f ($i + 1), $c.Name, ($c.Length / 1KB), $c.LastWriteTime | Write-Host
    }
    Write-Host ""
    $resposta = Read-Host "Qual restaurar? (1-$($copias.Count), ou Enter para cancelar)"
    if ($resposta -notmatch '^\d+$') { Write-Host "Cancelado."; exit 0 }
    $indice = [int]$resposta - 1
    if ($indice -lt 0 -or $indice -ge $copias.Count) { Parar "Escolha fora da lista." }
    $escolhida = $copias[$indice]
}

Write-Host ""
Write-Host "Escolhida: $($escolhida.Name)"

# ------------------------------------------------------------- a conferência
# Antes de tocar no banco atual. Trocar um banco que funciona por uma cópia
# ruim transforma um problema em dois.

function Conferir-Arquivo {
    param([string] $Arquivo)

    # Com $ErrorActionPreference = "Stop", o PowerShell transforma cada linha de
    # stderr de um programa externo em erro terminante — e aborta antes de o
    # código ler $LASTEXITCODE. Aqui a mensagem do conferidor é justamente o que
    # queremos mostrar, então o stderr precisa voltar a ser texto.
    #
    # Sem isto, quem está restaurando às pressas recebe um NativeCommandError com
    # pilha de chamada no lugar de "a cópia não presta, escolha outra".
    $anterior = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $saida = & node (Join-Path $PSScriptRoot "conferir-copia.mjs") $Arquivo 2>&1
        return [pscustomobject]@{
            Ok    = ($LASTEXITCODE -eq 0)
            Texto = (($saida | ForEach-Object { $_.ToString() }) -join "`n").Trim()
        }
    } finally {
        $ErrorActionPreference = $anterior
    }
}

Write-Host -NoNewline "Conferindo a cópia... "
$conferencia = Conferir-Arquivo $escolhida.FullName
if (-not $conferencia.Ok) {
    Write-Host ""
    Write-Host $conferencia.Texto -ForegroundColor Red
    Parar "A cópia não presta. Nada foi alterado; escolha outra."
}
Write-Host $conferencia.Texto -ForegroundColor Green

if ($Ensaio) {
    Write-Host ""
    Write-Host "Faria agora:" -ForegroundColor Yellow
    if ($eOBancoDoServico) { Write-Host "  - parar as tarefas: $($TAREFAS -join ', ')" }
    Write-Host "  - guardar $alvo (e -wal/-shm) numa pasta com a data"
    Write-Host "  - copiar $($escolhida.Name) para $alvo"
    if ($eOBancoDoServico) { Write-Host "  - subir as tarefas de novo" }
    exit 0
}

# ---------------------------------------------------------------- o serviço
# No Windows o arquivo fica preso enquanto o processo o tiver aberto: copiar por
# cima de um banco em uso dá EPERM, ou pior, deixa o arquivo pela metade.

function Esperar-Soltar {
    param([string] $Arquivo, [int] $Segundos = 15)
    if (-not (Test-Path $Arquivo)) { return $true }
    for ($i = 0; $i -lt $Segundos * 2; $i++) {
        try {
            $f = [System.IO.File]::Open($Arquivo, "Open", "ReadWrite", "None")
            $f.Close()
            return $true
        } catch { Start-Sleep -Milliseconds 500 }
    }
    return $false
}

$paradas = @()
if ($eOBancoDoServico) {
    foreach ($nome in $TAREFAS) {
        if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) {
            Stop-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
            $paradas += $nome
            Write-Host "Parei: $nome"
        }
    }
    if ($paradas.Count -eq 0) { Write-Host "As tarefas não estão instaladas; sigo." }
} else {
    Write-Host "Este não é o banco do serviço instalado; não mexo nas tarefas."
}

if (-not (Esperar-Soltar $alvo)) {
    Parar "O arquivo $alvo continua preso por algum processo. Feche o serviço e rode de novo. Nada foi alterado."
}

# ------------------------------------------------------------------- a troca
# O banco atual é guardado, nunca apagado: restaurar a cópia errada não pode ser
# um engano definitivo.
#
# O -wal e o -shm vão junto. Um -wal órfão ao lado de um banco restaurado é a
# forma silenciosa de estragar o que acabou de ser restaurado.

$guardados = $null
if (Test-Path $alvo) {
    $carimbo = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH-mm-ssZ")
    $guardados = Join-Path $pasta "antes-de-restaurar-$carimbo"
    New-Item -ItemType Directory -Force $guardados | Out-Null

    foreach ($sufixo in @("", "-wal", "-shm")) {
        $arquivo = "$alvo$sufixo"
        if (Test-Path $arquivo) { Move-Item -Path $arquivo -Destination $guardados -Force }
    }
    Write-Host "Banco anterior guardado em: $guardados"
}

try {
    Copy-Item -Path $escolhida.FullName -Destination $alvo -Force
} catch {
    Parar "A cópia falhou. O banco anterior está em $guardados — devolva-o para $alvo."
}

# Conferir de novo, agora o arquivo que ficou no lugar: o que importa não é a
# cópia na pasta, é o banco que o serviço vai abrir daqui a um segundo.
$depois = Conferir-Arquivo $alvo
if (-not $depois.Ok) {
    Write-Host $depois.Texto -ForegroundColor Red
    Write-Host "O banco anterior está em $guardados — devolva-o para $alvo." -ForegroundColor Red
    Parar "O banco restaurado não passou na conferência."
}

# ----------------------------------------------------------------- de volta
foreach ($nome in $paradas) {
    Start-ScheduledTask -TaskName $nome
    Write-Host "Subi: $nome"
}

Write-Host ""
Write-Host "Restaurado." -ForegroundColor Green
Write-Host "  De:  $($escolhida.Name)"
Write-Host "  Em:  $alvo"
Write-Host "  $($depois.Texto)"
if ($guardados) {
    Write-Host ""
    Write-Host "  Para desfazer: pare o serviço e devolva os arquivos de" -ForegroundColor Yellow
    Write-Host "  $guardados" -ForegroundColor Yellow
    Write-Host "  para o lugar do banco." -ForegroundColor Yellow
}
