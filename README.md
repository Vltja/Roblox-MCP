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
*   **Performance Optimized:** The `multi` tool allows executing dozens of actions in a single AI turn.

---

## 🧐 Why choose this MCP? (Comparison)

This implementation is built for **productivity, safety, and token efficiency**. Unlike basic reference implementations, it provides professional tools for real-world development.

| Feature | Official Reference | Other Community Tools | **This Implementation** |
| :--- | :--- | :--- | :--- |
| **Script Editing** | Overwrite / Basic | Mostly Overwrite | **Precise Search-and-Replace (`editScript`)** |
| **Efficiency** | One-by-one calls | One-by-one calls | **Powerful `multi` tool (Saves Tokens & Time)** |
| **Security** | Permission prompts | Often none | **Full Dashboard GUI with Whitelist & Approvals** |
| **Batch Creation** | Manual | Manual | **Native Loops & Variables support** |
| **Stability** | Proof of Concept | Experimental | **Production Ready (Optimized Task Scheduling)** |

### Key Advantages:
1.  **Massive Token Savings & Precision:** Our `editScript` pinpoint search-and-replace method allows the AI to modify specific lines without re-sending or overwriting entire files. This saves thousands of tokens and prevents accidental code destruction.
2.  **Context Efficiency (Intuitive Discovery):** Tools like `scriptSearch`, `readLine`, and `tree` allow the AI to "feel" your project intuitively. It can instantly find any script, variable, or object without wasting dozens of tool calls just to "find where things are."
3.  **The `multi` Tool Power:** Chaining dozens of actions (e.g., "Build a stadium with 100 seats and light it up") into a single request drastically reduces latency and API costs while making complex automation reliable.
4.  **Local Firewall:** The built-in Express Dashboard acts as a security layer. You see every command before it executes and can block anything suspicious.

---

## 🚀 Installation (Step-by-Step)

### 1. Prerequisites
*   **Node.js:** [Download & Install v22.12.0 LTS](https://nodejs.org/)  
    *   *Recommended:* **v22.12.0** (Explicitly tested. If you face connection issues with newer versions, use this one).
*   **Google Chrome:** Required for the Dashboard GUI.
*   **Roblox Studio:** With a place open.

### 2. Setup the Server
Choose **one** of the following options to get the code:

*   **Option A: Download ZIP (Easiest)**
    [**Click here to Download the Project**](https://github.com/Vltja/Roblox-MCP/archive/refs/heads/main.zip)  
    *(Then extract the ZIP file to a folder on your PC, e.g., `C:\RobloxMCP`)*

*   **Option B: Using Git (Advanced)**
    Open a terminal and run:
    ```bash
    git clone https://github.com/Vltja/Roblox-MCP.git
    ```

**After getting the code:**
1.  Open a Terminal (CMD or PowerShell) in your folder (e.g., `C:\RobloxMCP`).
2.  Run: `npm install` (This installs the necessary libraries).

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