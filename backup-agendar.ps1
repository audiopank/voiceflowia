# Registra o backup diario do VoiceFlow IA na Tarefa Agendada do Windows.
# Rode UMA vez, no PowerShell, dentro da pasta do projeto:
#     powershell -ExecutionPolicy Bypass -File .\backup-agendar.ps1
#
# Nao precisa de administrador: a tarefa e criada no seu usuario.
# Pra remover depois:  Unregister-ScheduledTask -TaskName "VoiceFlow Backup Diario"

$projeto = $PSScriptRoot
$script  = Join-Path $projeto 'backup-auto.cmd'
$nome    = 'VoiceFlow Backup Diario'

if (-not (Test-Path $script)) { Write-Error "nao achei $script"; exit 1 }

# 26/11/2026: roda pelo .vbs, SEM janela — a janela preta era fechada sem querer e matava o backup.
$escondido = Join-Path $projeto 'backup-auto-escondido.vbs'
$acao = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$escondido`"" -WorkingDirectory $projeto
# 12h00 todo dia. "StartWhenAvailable" faz a tarefa rodar assim que a maquina ligar,
# caso ela estivesse desligada no horario — sem isso, PC desligado = dia sem backup.
$gatilho = New-ScheduledTaskTrigger -Daily -At 12:00
$config  = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
             -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName $nome -Action $acao -Trigger $gatilho `
  -Settings $config -Description 'Copia diaria do banco do VoiceFlow IA para D:\backups-voiceflow' -Force | Out-Null

Write-Host "OK - tarefa '$nome' registrada para 12:00 todo dia."
Write-Host "Rodar agora pra testar:  Start-ScheduledTask -TaskName '$nome'"
