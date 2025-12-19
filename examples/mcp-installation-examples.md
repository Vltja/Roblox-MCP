# MCP Installation Examples

This directory contains configuration examples for various AI agents and IDEs that support the Model Context Protocol (MCP).

## 🤖 Supported Systems

### 1. Claude Desktop (Anthropic)
**Config Path:**
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "roblox-studio": {
      "command": "node",
      "args": ["C:/YOUR_PATH/mcp-server.js"]
    }
  }
}
```

### 2. Cursor (AI Code Editor)
**Settings:** `Settings > Features > MCP`
1. Add New MCP Server.
2. Name: `roblox-studio`
3. Type: `stdio`
4. Command: `node "C:/YOUR_PATH/mcp-server.js"`

### 3. Roo Code / Cline / Cline (VS Code Extensions)
**Settings:** Open the extension settings and add the following to the MCP configuration:
```json
{
  "mcpServers": {
    "roblox-studio": {
      "command": "node",
      "args": ["C:/YOUR_PATH/mcp-server.js"]
    }
  }
}
```

### 4. Windsurf (Codeium)
**Config Path:**
- **Windows:** `%USERPROFILE%\.codeium\windsurf\mcp_config.json`
- **macOS:** `~/.codeium/windsurf/mcp_config.json`

```json
{
  "mcpServers": {
    "roblox-studio": {
      "command": "node",
      "args": ["C:/YOUR_PATH/mcp-server.js"]
    }
  }
}
```

### 5. Claude Code (CLI)
Run the following command in your terminal:
```bash
claude mcp add roblox-studio --command node --args "C:/YOUR_PATH/mcp-server.js"
```

### 6. Gemini CLI / Google Gemini CLI
**GitHub:** [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli)
Follow their documentation to add a local stdio MCP server.

---

## 📁 Path Formatting Tips

When editing JSON configuration files:
- **Windows:** Use forward slashes `/` (e.g., `C:/Path/to/file.js`) OR double backslashes `\` (e.g., `C:\Path\to\file.js`).
- **macOS/Linux:** Use standard Unix paths (e.g., `/Users/name/Path/to/file.js`).

---

## 🔍 Verification

To verify your installation:
1. Ensure the Express Server is running (`ExpressServer\start-server.bat`).
2. Open your AI agent.
3. It should now list new tools like `tree`, `create`, `get`, etc.
4. Try asking: "Can you see my Roblox Workspace?"
