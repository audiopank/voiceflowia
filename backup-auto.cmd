@echo off
REM Backup automatico do banco do VoiceFlow IA.
REM
REM Roda pela Tarefa Agendada do Windows (ver backup-agendar.ps1). Fica na maquina
REM do Mestre de proposito: o repositorio no GitHub e PUBLICO, entao artefato de
REM CI seria dado de cliente exposto; e guardar a copia dentro do proprio Supabase
REM nao protege contra o Supabase cair, que e o risco que este backup existe pra
REM cobrir.
REM
REM Mantem as ultimas 14 copias e apaga as mais antigas.

cd /d "%~dp0"
if not exist "D:\backups-voiceflow" mkdir "D:\backups-voiceflow"

echo [%date% %time%] iniciando backup >> "D:\backups-voiceflow\_log.txt"
node backup-dados.mjs .env.local >> "D:\backups-voiceflow\_log.txt" 2>&1
REM Guarda o codigo ANTES do bloco: dentro de parenteses o %errorlevel% e expandido
REM quando o bloco e LIDO, nao quando roda - o log e o exit /b sairiam sempre com o
REM valor velho (0) e a Tarefa Agendada marcaria "sucesso" num backup que falhou.
set CODIGO=%errorlevel%
if not "%CODIGO%"=="0" (
  echo [%date% %time%] FALHOU ^(codigo %CODIGO%^) >> "D:\backups-voiceflow\_log.txt"
  exit /b %CODIGO%
)

REM Retencao: mantem as 14 pastas mais recentes de backup.
for /f "skip=14 delims=" %%D in ('dir "D:\backups-voiceflow\voiceflow_*" /b /ad /o-d 2^>nul') do (
  rmdir /s /q "D:\backups-voiceflow\%%D"
  echo [%date% %time%] removida copia antiga: %%D >> "D:\backups-voiceflow\_log.txt"
)

echo [%date% %time%] concluido >> "D:\backups-voiceflow\_log.txt"
