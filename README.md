# 🤖 Roblox Studio MCP Server

> **Control Roblox Studio directly with AI (Claude, Cursor, Roo Code, etc.) via the Model Context Protocol.**

This project provides the **MCP Server** and **Local Bridge** to connect AI agents to Roblox Studio.  
**Note:** To execute commands in Roblox Studio, you need the companion **Roblox Plugin**.

## ✨ Features

*   **Direct Control:** Create Scripts, Parts, Models, and read/edit code directly from your AI chat.
*   **Loop & Batch Creation:** Create hundreds of objects (e.g., stairs, forests) with a single command.
*   **Smart Script Conversion:** Convert `Script` ↔ `LocalScript` ↔ `ModuleScript` instantly.
*   **Security Dashboard:** A local GUI to approve or deny every action the AI tries to perform.
*   **Performance Optimized:** The `multi` tool allows executing dozens of actions in a single AI turn.

---

## 🚀 Installation (Step-by-Step)

### 1. Prerequisites
*   **Node.js:** [Download & Install LTS Version](https://nodejs.org/) (Required).
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
*   *Note: Without the Premium Plugin, the server will connect but cannot execute commands.*

---

## ⚙️ Configuring your AI Agent

MCP requires the **absolute path** to the `mcp-server.js` file.  
**Important:** In JSON files, use forward slashes `/` or double backslashes `\` (e.g., `C:/RobloxMCP/mcp-server.js`).

### 1. Claude Desktop
*   **Config Path:** `%APPDATA%\Claude\claude_desktop_config.json`
Add this to the `mcpServers` section:
```json
"roblox-studio": {
  "command": "node",
  "args": ["C:/YOUR_PATH/mcp-server.js"]
}
```

### 2. Cursor / Roo Code / Windsurf
Go to the MCP settings of your IDE and add a new `stdio` server:
*   Command: `node "C:/YOUR_PATH/mcp-server.js"`

---

## 🖥️ Usage

1.  **Start the Bridge Server:**  
    **CRITICAL:** You must start the Express server manually before or during your AI session.  
    Run the following file:  
    `ExpressServer\start-server.bat`  
    *This opens a Chrome window (The Dashboard). Keep it open!*

2.  **In Roblox Studio:**  
    Open your place and click **"Verbinden"** in the RobloxMCP Premium widget.

3.  **Chat with AI:**  
    Start talking to your AI. The Dashboard will prompt you to approve sensitive actions.

---

## 🧰 Available MCP Tools

This server provides a comprehensive toolset for Roblox development:

| Tool | Description |
| :--- | :--- |
| `tree` | Returns the full hierarchy tree of any object path. |
| `get` | Reads specific properties and attributes from an object. |
| `create` | Creates parts, scripts, folders, etc. Supports Batch-mode & Loops. |
| `modifyObject` | Modifies properties or replaces the entire source code of a script. |
| `editScript` | **AI Workflow:** Precise search-and-replace for script code. |
| `readLine` | Reads specific line ranges from any script. |
| `insertLines` | Inserts new lines of code at a specific position. |
| `deleteLines` | Deletes a range of lines from a script. |
| `getScriptInfo` | Returns metadata like line count and character count. |
| `scriptSearch` | Global search for text across ALL scripts in the game. |
| `copy` | Clones an object to a new destination. |
| `delete` | Permanently removes an object from the game. |
| `convertScript` | Changes a script's class (e.g., Script to LocalScript) while keeping code. |
| `multi` | **Power Tool:** Executes multiple tool calls in a single sequence. |

### 🚀 The `multi` Tool Advantage
The `multi` tool is designed for complex tasks. Instead of the AI calling one tool at a time (which is slow and costs more tokens), it can bundle dozens of commands:
*   **Example:** "Create a folder, put 50 parts inside, and then add a script to each." 
*   The AI sends one `multi` call, and the server executes them sequentially in Roblox Studio.
*   **Benefit:** Faster execution, reduced latency, and lower API costs.

---

## 🛡️ Security
The Dashboard at `http://localhost:3000` is your firewall. 
*   **Whitelist:** Safe tools like `tree` or `get` can be allowed to run without asking.
*   **Manual Approval:** Critical tools like `delete` or `editScript` will wait for you to click **"Accept"** in the browser.

---
*Roblox Studio MCP - The bridge between AI and Creation.*