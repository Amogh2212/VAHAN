Option Explicit

Dim shell, fso, scriptDir, repoRoot, powershell, psScript, job, command, exitCode

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repoRoot = fso.GetParentFolderName(scriptDir)
powershell = shell.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
psScript = fso.BuildPath(scriptDir, "run-local-db-task.ps1")
job = "rto-daily"

If WScript.Arguments.Count > 0 Then
  job = WScript.Arguments(0)
End If

shell.CurrentDirectory = repoRoot
command = Quote(powershell) & " -WindowStyle Hidden -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " & Quote(psScript) & " -Job " & Quote(job)
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
