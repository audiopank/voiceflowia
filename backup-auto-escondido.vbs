' Roda o backup-auto.cmd SEM janela (26/11/2026). A janela preta da Tarefa Agendada era fechada
' sem querer e matava o backup no meio (23/11: resultado 0xC000013A). O codigo de saida do .cmd
' volta pra Tarefa Agendada, entao "falhou" continua aparecendo como falha.
Set fso = CreateObject("Scripting.FileSystemObject")
cmd = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "backup-auto.cmd")
WScript.Quit CreateObject("WScript.Shell").Run("""" & cmd & """", 0, True)
