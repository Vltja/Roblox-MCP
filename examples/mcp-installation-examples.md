# MCP Installation Examples

Allgemeine Installationsanleitungen für verschiedene MCP-fähige Systeme und KIs.

## 🔧 Allgemeine MCP-Konfiguration

Dieser MCP-Server funktioniert mit **jeder** KI oder Anwendung, die das Model Context Protocol (MCP) unterstützt.

### Grundlegende Konfiguration

Die meisten MCP-fähigen Systeme benötigen zwei Informationen:
1. **Command:** `node`
2. **Args:** Pfad zur `mcp-server.js` Datei
3. **Path/Directory:** Arbeitsverzeichnis (optional)

---

## 🤖 Unterstützte Systeme

### 1. Claude Desktop (Anthropic)
**Konfigurationsdatei:**
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux:** `~/.config/claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "roblox-studio": {
      "command": "node",
      "args": ["C:\\Pfad\\zu\\roblox-studio-mcp\\mcp-server.js"],
      "env": {}
    }
  }
}
```

### 2. KiloCode CLI
```bash
# Installation
kilocode install-mcp roblox-studio --command "node" --args "C:\\Pfad\\zu\\roblox-studio-mcp\\mcp-server.js"

# Oder über Konfigurationsdatei
kilocode config set mcp.roblox-studio.command "node"
kilocode config set mcp.roblox-studio.args "C:\\Pfad\\zu\\roblox-studio-mcp\\mcp-server.js"
```

### 3. Google Gemini CLI
```bash
# Konfiguration
gemini mcp add roblox-studio \
  --command "node" \
  --args "/pfad/zu/roblox-studio-mcp/mcp-server.js"

# Aktivieren
gemini mcp enable roblox-studio
```

### 4. Continue.dev (VS Code)
**VS Code Settings:** `settings.json`
```json
{
  "continue.mcpServers": {
    "roblox-studio": {
      "command": "node",
      "args": ["/pfad/zu/roblox-studio-mcp/mcp-server.js"],
      "cwd": "/pfad/zu/roblox-studio-mcp"
    }
  }
}
```

### 5. Cursor (AI Code Editor)
**Konfiguration:** `~/.cursor/rules` oder GUI-Einstellungen
```json
{
  "mcpServers": {
    "roblox-studio": {
      "command": "node",
      "args": ["~/roblox-studio-mcp/mcp-server.js"],
      "env": {}
    }
  }
}
```

### 6. Cline (VS Code Extension)
```json
{
  "mcpServers": {
    "roblox-studio": {
      "command": "node",
      "args": ["~/roblox-studio-mcp/mcp-server.js"],
      "disabled": false
    }
  }
}
```

---

## 📁 Pfad-Beispiele für verschiedene Betriebssysteme

### Windows
```json
{
  "command": "node",
  "args": ["C:\\Users\\Username\\Desktop\\roblox-studio-mcp\\mcp-server.js"]
}
```

### macOS
```json
{
  "command": "node",
  "args": ["/Users/Username/Desktop/roblox-studio-mcp/mcp-server.js"]
}
```

### Linux
```json
{
  "command": "node",
  "args": ["/home/username/roblox-studio-mcp/mcp-server.js"]
}
```

---

## 🔍 Test der Installation

### 1. Server direkt testen
```bash
cd roblox-studio-mcp
node mcp-server.js
```

**Erwartete Ausgabe:**
```
✅ All dependencies already installed
✅ MCP Server bereit (Roblox Studio)
```

### 2. MCP-Verbindung testen
Die meisten MCP-fähigen Systeme bieten einen Test-Befehl:

```bash
# Claude Desktop
claude mcp list

# KiloCode
kilocode mcp test roblox-studio

# Gemini CLI
gemini mcp list

# Continue
# Über VS Code Command Palette: "Continue: Test MCP Connection"
```

---

## 🚨 Häufige Probleme & Lösungen

### Problem: "node: command not found"
**Lösung:** Node.js installieren (https://nodejs.org/)

### Problem: "Cannot find module"
**Lösung:** Im richtigen Verzeichnis ausführen:
```bash
cd /pfad/zu/roblox-studio-mcp
node mcp-server.js
```

### Problem: Pfad nicht gefunden
**Lösung:** Vollständigen Pfad verwenden:
- Windows: `C:\\Users\\Name\\...`
- Mac/Linux: `/home/name/...`

### Problem: Roblox Server nicht erreichbar
**Lösung:** Stelle sicher, dass Roblox Studio Plugin auf `localhost:3000` läuft

---

## 🛠️ Erweiterte Konfiguration

### Mit Umgebungsvariablen
```json
{
  "command": "node",
  "args": ["~/roblox-studio-mcp/mcp-server.js"],
  "env": {
    "ROBLOX_API_URL": "http://localhost:3000",
    "DEBUG": "true"
  }
}
```

### Mit Arbeitsverzeichnis
```json
{
  "command": "node",
  "args": ["mcp-server.js"],
  "cwd": "~/roblox-studio-mcp"
}
```

---

## 📚 MCP Kompatibilität

Dieser Server ist kompatibel mit:
- ✅ **Claude Desktop** (Anthropic)
- ✅ **KiloCode CLI**
- ✅ **Google Gemini CLI**
- ✅ **Continue.dev** (VS Code)
- ✅ **Cursor** (AI Editor)
- ✅ **Cline** (VS Code Extension)
- ✅ **Jede MCP-fähige Anwendung**

### MCP Version Support
- ✅ **MCP v1.0+** (current)
- ✅ **Stdio Transport**
- ✅ **JSON-RPC 2.0**

---

## 🔗 Nützliche Ressourcen

- [MCP Specification](https://modelcontextprotocol.io/)
- [Claude Desktop Setup](https://docs.anthropic.com/claude/docs/mcp)
- [KiloCode Documentation](https://kilocode.dev/docs/mcp)
- [Continue.dev MCP Guide](https://continue.dev/docs/mcp)

---

💡 **Tipp:** Kopiere die passende Konfiguration für dein System und passe nur den Pfad an!