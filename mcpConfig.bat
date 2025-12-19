@echo off
setlocal

echo ===============================
echo    MCP Config Generator
echo ===============================
echo.

:: Aktuelles Verzeichnis holen
set "CURRENT_DIR=%CD%"
echo Aktueller Pfad: %CURRENT_DIR%

:: MCP JSON Datei erstellen
set "MCP_FILE=%CURRENT_DIR%\.mcp.json"

echo.
if exist "%MCP_FILE%" (
    echo ⚠️  Bestehende .mcp.json gefunden - überschreibe Datei...
) else (
    echo ✅ Erstelle neue .mcp.json...
)
echo.

:: JSON Inhalt erstellen mit absolutem Pfad
:: Alle Backslashes für JSON escapen
set "JSON_PATH=%CURRENT_DIR:\=\\%"
set "JSON_MCP_SERVER=%JSON_PATH%\\mcp-server.js"

(
echo {
echo   "mcpServers": {
echo     "roblox-studio": {
echo       "command": "node",
echo       "args": ["%JSON_MCP_SERVER%"],
echo       "env": {}
echo     }
echo   }
echo }
) > "%MCP_FILE%"

if exist "%MCP_FILE%" (
    echo.
    echo ✅ ERFOLG! .mcp.json wurde erstellt:
    echo    %MCP_FILE%
    echo.
    echo Inhalt der Datei:
    echo ===============================
    type "%MCP_FILE%"
    echo ===============================
    echo.
    echo Du kannst jetzt MCP starten mit: claude-desktop --mcp-server
) else (
    echo.
    echo ❌ FEHLER! Konnte .mcp.json nicht erstellen.
    echo.
    echo Bitte stelle sicher, dass du Schreibrechte hast.
)

echo.
pause