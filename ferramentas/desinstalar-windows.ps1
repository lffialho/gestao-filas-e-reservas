#Requires -Version 5.1
<#
.SYNOPSIS
    Tira o salão do arranque do Windows.

.DESCRIPTION
    Para e remove as duas tarefas agendadas criadas por instalar-windows.ps1.
    Não mexe no banco, nas cópias nem nos arquivos do projeto — desinstalar não
    pode ser o comando que apaga o histórico do restaurante.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File ferramentas\desinstalar-windows.ps1
#>

$ErrorActionPreference = "Stop"

foreach ($nome in @("Salao - servico", "Salao - painel")) {
    $tarefa = Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
    if (-not $tarefa) {
        Write-Host "Não estava instalada: $nome"
        continue
    }

    Stop-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $nome -Confirm:$false
    Write-Host "Removida: $nome"
}

Write-Host ""
Write-Host "O banco e a pasta de cópias continuam onde estavam." -ForegroundColor Green
