# Roblox Studio MCP Server (WebSocket Edition)

A Model Context Protocol (MCP) server for Roblox Studio integration using **WebSocket** for real-time bidirectional communication.

## 🚀 Features

- **WebSocket Communication**: Direct real-time connection between MCP server and Roblox plugin
- **No HTTP Polling**: Eliminates latency and resource overhead of polling
- **15 Roblox Studio Tools**: Complete set of tools for object manipulation, script editing, and more
- **Tool Whitelist UI**: Built-in control panel to enable/disable specific tools
- **Auto-Reconnect**: Robust connection handling with automatic reconnection

## 📦 Architecture

```
┌─────────────────┐     stdio      ┌─────────────────┐
│   AI (Claude)   │◄──────────────►│   MCP Server    │
└─────────────────┘                │  (mcp-server.js)│
                                   └────────┬────────┘
                                            │
                                     WebSocket (port 3001)
                                            │
                                   ┌────────▼────────┐
                                   │  Roblox Plugin  │
                                   │ (MainScript.lua)│
                                   └─────────────────┘
```

## 🔧 Installation

### 1. Install Dependencies

```bash
cd roblox-studio-mcp
npm install
```

### 2. Configure MCP Client

Add to your MCP client configuration (Claude Desktop, Cursor, etc.):

```json
{
  "mcpServers": {
    "roblox-studio": {
      "command": "node",
      "args": ["/path/to/roblox-studio-mcp/mcp-server.js"],
      "env": {
        "MCP_WS_PORT": "3001"
      }
    }
  }
}
```

### 3. Install Roblox Plugin

1. Open Roblox Studio
2. Go to **Plugins** → **Open Plugins Folder**
3. Copy the entire `neue-plugin-architektur` folder or convert to `.rbxm` format
4. Restart Roblox Studio

### 4. Connect Plugin to MCP Server

1. In Roblox Studio, open the **MCP Settings** panel from the toolbar
2. Configure the server IP (default: `localhost`)
3. Configure the WebSocket port (default: `3001`)
4. Click **Connect**

## 🛠️ Available Tools

| Tool | Description | Safe |
|------|-------------|------|
| `tree` | Get object hierarchy tree | ✅ |
| `get` | Read properties and attributes | ✅ |
| `copy` | Clone objects | ✅ |
| `readLine` | Read specific script lines | ✅ |
| `getScriptInfo` | Get script metadata | ✅ |
| `scriptSearch` | Search across all scripts | ✅ |
| `scriptSearchOnly` | Search in specific script | ✅ |
| `editScript` | Precise string replacement | ✅ |
| `convertScript` | Convert script type | ✅ |
| `create` | Create new objects | ⚠️ |
| `modifyObject` | Modify objects/scripts | ⚠️ |
| `delete` | Delete objects | ⚠️ |
| `deleteLines` | Delete script lines | ⚠️ |
| `insertLines` | Insert script lines | ⚠️ |
| `multi` | Execute multiple tools | ⚠️ |

## 📁 Project Structure

```
roblox-studio-mcp/
├── mcp-server.js           # MCP + WebSocket server
├── package.json            # Node.js dependencies
├── neue-plugin-architektur/
│   ├── MainScript.lua      # WebSocket client & orchestration
│   ├── UIManager.lua       # Settings UI (DockWidget)
│   ├── ToolControlPanel.lua # Tool whitelist management
│   ├── EventAPI.lua        # Event bus for tool communication
│   ├── Helpers.lua         # Utility functions
│   └── Tools/              # Individual tool implementations
│       ├── TreeTool.lua
│       ├── CreateTool.lua
│       ├── GetTool.lua
│       └── ... (14 tools)
```

## 🔌 WebSocket Protocol

### Message Format

```json
{
  "type": "command" | "result" | "ping" | "pong",
  "id": "unique-request-id",
  "tool": "toolName",
  "params": { ... },
  "result": { ... },
  "error": null | "error message"
}
```

### Communication Flow

1. Plugin connects to `ws://localhost:3001`
2. AI calls tool → MCP Server sends `{type: "command", ...}` via WebSocket
3. Plugin receives command, executes tool via EventAPI
4. Plugin sends `{type: "result", ...}` back via WebSocket
5. MCP Server returns result to AI

## 🖥️ UI Features

### MCP Settings Panel
- Server IP/Port configuration
- Connect/Disconnect button
- Connection status indicator
- Persistent settings (saved to plugin attributes)

### Tool Control Panel
- Enable/disable individual tools
- "Allow All" toggle
- "Safe Only" preset
- Visual indication of safe vs. editing tools

## ⚙️ Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MCP_WS_PORT` | `3001` | WebSocket server port |

## 🐛 Troubleshooting

### Plugin won't connect
- Ensure MCP server is running (`node mcp-server.js`)
- Check firewall settings for port 3001
- Verify IP address is correct (use `localhost` for local)

### Tools not executing
- Open Tool Control Panel and ensure tools are enabled
- Check Roblox Studio output window for errors

### WebSocket errors in Roblox
- Ensure `HttpService:CreateWebStreamClient()` is available (Roblox Studio 2024+)
- Check network connectivity

## 📜 License

MIT License
