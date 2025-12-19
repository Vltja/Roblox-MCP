Set WshShell = CreateObject("WScript.Shell")
Set objFSO = CreateObject("Scripting.FileSystemObject")
' Aktuelles Verzeichnis dynamisch ermitteln
strScriptPath = objFSO.GetParentFolderName(WScript.ScriptFullName)
' Starte Wrapper im aktuellen Verzeichnis
WshShell.Run "cmd /c cd /d """ & strScriptPath & """ && node wrapper.js", 0, False
