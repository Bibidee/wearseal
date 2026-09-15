Get-ChildItem "$PSScriptRoot\..\contracts\*.py" | ForEach-Object { python -m py_compile $_.FullName }
