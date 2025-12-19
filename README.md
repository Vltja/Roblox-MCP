# 🤖 Roblox Studio MCP Server

> **Control Roblox Studio directly with AI (Claude, Cursor, Roo Code, etc.) via the Model Context Protocol.**

This project provides the **MCP Server** and **Local Bridge** to connect AI agents to Roblox Studio.  
**Note:** To execute commands in Roblox Studio, you need the companion **Roblox Plugin**.

## ✨ Features

*   **Direct Control:** Create Scripts, Parts, Models, and read/edit code directly from your AI chat.
*   **Loop & Batch Creation:** Create hundreds of objects (e.g., stairs, forests) with a single command.
*   **Smart Script Conversion:** Convert `Script` ↔ `LocalScript` ↔ `ModuleScript` instantly.
*   **Security Dashboard:** A local GUI to approve or deny every action the AI tries to perform.
*   **Safety First:** Whitelist safe tools (like `tree`) and require manual confirmation for critical ones (like `delete`).

---

## 🚀 Installation (Step-by-Step)

### 1. Prerequisites
*   **Node.js:** [Download & Install LTS Version](https://nodejs.org/) (Required to run the server).
*   **Google Chrome:** Required for the Dashboard GUI.
*   **Roblox Studio:** With a place open.

### 2. Setup the Server
1.  Download or Clone this repository to a folder on your PC (e.g., `C:\RobloxMCP`).
2.  Open a Terminal (CMD or PowerShell) in that folder.
3.  Run: `npm install`

### 3. Install Roblox Plugins

#### A. Bridge Plugin (Open Source)
1.  Open **Roblox Studio**.
2.  Create a new **Script** in `ServerScriptService` and name it `BridgePlugin`.
3.  Copy the code from `BridgePlugin/BridgePluginScript.lua` in this repo and paste it into the script.
4.  Right-click the script -> **Save as Local Plugin...** -> Save.

#### B. 💎 Premium Plugin (Required for Execution)
This handles the heavy lifting like code generation and secure execution.
*   [**Get it here on Roblox Store**](https://create.roblox.com/store/asset/83680138548519/PremiumPlugin)
*   *Make sure **HttpService** is enabled in Game Settings -> Security.*

---

## ⚙️ Configuring your AI Agent

MCP requires the **absolute path** to the `mcp-server.js` file.  
**Windows Tip:** Shift + Right-click `mcp-server.js` -> "Copy as path".  
**Important:** In JSON files, use forward slashes `/` or double backslashes `\\` (e.g., `C:/RobloxMCP/mcp-server.js`).

### 1. Claude Desktop
*   **Config Path:** `%APPDATA%\Claude\claude_desktop_config.json`
*   **Official Guide:** [Anthropic MCP Setup](https://modelcontextprotocol.io/quickstart/user)

Add this to the `mcpServers` section:
```json
"roblox-studio": {
  "command": "node",
  "args": ["C:/YOUR_PATH/mcp-server.js"]
}
```

### 2. Cursor
*   **Settings:** `Settings > Features > MCP`
*   **Official Guide:** [Cursor MCP Docs](https://docs.cursor.com/features/mcp)
1. Click **"+ Add New MCP Server"**.
2. Name: `roblox-studio` | Type: `stdio`.
3. Command: `node "C:/YOUR_PATH/mcp-server.js"`

### 3. Roo Code / Cline (VS Code)
*   **Settings:** Open the extension and go to `Settings > MCP Servers`.
*   **Official Guide:** [Roo Code Config](https://github.com/RooCode/Roo-Code)
1. Edit the MCP Config file through the UI.
2. Add the same JSON block as shown in the "Claude Desktop" section.

### 4. Windsurf
*   **Config Path:** `~/.codeium/windsurf/mcp_config.json`
*   **Official Guide:** [Windsurf MCP Docs](https://docs.codeium.com/windsurf/mcp)
Add the server definition under the `mcpServers` key.

### 5. Claude Code (CLI)
*   **Command:** Run this in your terminal:
*   **Official Guide:** [Claude Code Guide](https://docs.anthropic.com/en/docs/agents-and-tools/claude-code)
```bash
claude mcp add roblox-studio --command node --args "C:/YOUR_PATH/mcp-server.js"
```

### 6. Gemini CLI (Google)
*   **Official Repo:** [Google Gemini CLI](https://github.com/google-gemini/gemini-cli)
Add the server definition to your Gemini CLI configuration (usually located in `~/.config/gemini-cli/config.json` or as specified in their documentation).

---

## 🖥️ Usage

1.  **Open Roblox Studio** and click **"Verbinden"** in the RobloxMCP Premium widget.
2.  **Start your AI Agent** (Claude, Cursor, etc.).
3.  A **Chrome window** will open (The Dashboard). **Keep it open!**
4.  **Chat:** Ask the AI to build something!
    *   "Create a row of 10 red neon parts"
    *   "List all scripts in the game"
    *   "Change the Transparency of all Parts in Workspace to 0.5"

## 🛡️ Security
The Dashboard at `http://localhost:3000` is your firewall. 
*   **Whitelist:** Safe tools like `tree` or `get` can be allowed to run without asking.
*   **Manual Approval:** Critical tools like `delete` or `editScript` will wait for you to click **"Accept"** in the browser.

---
*Roblox Studio MCP - The bridge between AI and Creation.*