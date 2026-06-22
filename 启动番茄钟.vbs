' 🍅 番茄钟静默启动器 - 无黑窗口
' 用 pythonw.exe 在后台静默运行番茄钟

Dim shell, scriptPath, fso
Set fso = CreateObject("Scripting.FileSystemObject")
scriptPath = fso.GetParentFolderName(WScript.ScriptFullName) & "\pomodoro.py"
Set shell = CreateObject("WScript.Shell")

' 使用完整路径的 pythonw.exe 避免 WindowsApps 占位符干扰
shell.Run """C:\Program Files\Python312\pythonw.exe"" """ & scriptPath & """", 0, False
