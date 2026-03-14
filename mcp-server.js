#!/usr/bin/env node
/**
 * MCP SERVER V2 - Mit Router/Broker Architektur
 * 
 * Features:
 * - Lazy-Start: Startet Router automatisch wenn nicht läuft
 * - Multi-Agent: Mehrere MCPs können sich am Router registrieren
 * - Fallback: Kann auch direkt ohne Router arbeiten
 * - UUID-basierte Agent-Identifikation
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import WebSocket from 'ws';
import { spawn } from 'child_process';
import net from 'net';
import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ========== LOGGING SYSTEM ==========
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
import { checkForUpdates } from './update-check.js';
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, `mcp-server-v2-${new Date().toISOString().slice(0, 10)}.log`);

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function log(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}`;
  console.error(logLine);
  try {
    fs.appendFileSync(LOG_FILE, logLine + '\n');
  } catch (e) {
    console.error('[LOG ERROR] Could not write to log file:', e.message);
  }
}

function cleanOldLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const filePath = path.join(LOG_DIR, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        log(`[LOG] Deleted old log file: ${file}`);
      }
    }
  } catch (e) {
    log(`[LOG ERROR] Could not clean old logs: ${e.message}`);
  }
}

cleanOldLogs();
checkForUpdates();
log(`[MCP-V2] Log file: ${LOG_FILE}`);

// ========== CONFIGURATION ==========
const CONFIG = {
  TIMEOUT: 120000,
  MAX_RESPONSE_SIZE: 50 * 1024 * 1024,
  PLUGIN_PORT: parseInt(process.env.MCP_PLUGIN_PORT) || 3001,
  ROUTER_PORT: parseInt(process.env.MCP_ROUTER_PORT) || 4000,
  RECONNECT_INTERVAL: 5000,
  MAX_RECONNECT_ATTEMPTS: 10
};

// ========== AGENT IDENTITY ==========
const AGENT_ID = crypto.randomUUID();
log(`[MCP-V2] Agent ID: ${AGENT_ID}`);

// ========== STATE ==========
let routerWs = null;
let routerProcess = null;
let isConnected = false;
let pendingRequests = new Map();
let reconnectAttempts = 0;

// ========== PORT CHECK & ROUTER START ==========
function checkPort(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timeout = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 1000);
    
    socket.connect(port, 'localhost', () => {
      clearTimeout(timeout);
      socket.destroy();
      resolve(true);
    });
    
    socket.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

function waitForPort(port, maxWait = 10000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    const checkInterval = setInterval(async () => {
      const isReady = await checkPort(port);
      
      if (isReady) {
        clearInterval(checkInterval);
        log(`[MCP-V2] Port ${port} ist bereit`);
        resolve(true);
      } else if (Date.now() - startTime > maxWait) {
        clearInterval(checkInterval);
        reject(new Error(`Timeout waiting for port ${port}`));
      }
    }, 500);
  });
}

// ========== ROUTER START ==========
async function startRouter() {
  log('[MCP-V2] Starte Router als Child Process...');

  // Prüfe ob bereits ein Router läuft
  const routerPortReady = await checkPort(CONFIG.ROUTER_PORT);
  if (routerPortReady) {
    log('[MCP-V2] Router läuft bereits - kein Neustart nötig');
    return;
  }

  // Starte Router als Child Process
  routerProcess = spawn('node', ['router-server.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env }
  });

  routerProcess.on('error', (err) => {
    log(`[MCP-V2] Router Process Error: ${err.message}`);
  });

  routerProcess.on('exit', (code, signal) => {
    log(`[MCP-V2] Router Process beendet: code=${code}, signal=${signal}`);
    routerProcess = null;
  });

  // Warte bis beide Ports bereit sind
  try {
    await waitForPort(CONFIG.PLUGIN_PORT, 10000);
    log('[MCP-V2] ✅ Router Plugin-Port bereit');
  } catch (e) {
    log(`[MCP-V2] ❌ Plugin-Port Timeout: ${e.message}`);
    throw e;
  }

  try {
    await waitForPort(CONFIG.ROUTER_PORT, 5000);
    log('[MCP-V2] ✅ Router MCP-Port bereit');
  } catch (e) {
    log(`[MCP-V2] ⚠️ Router MCP-Port nicht bereit: ${e.message}`);
    throw e;
  }

  log('[MCP-V2] ✅ Router gestartet');
}

async function ensureRouterRunning() {
  log('[MCP-V2] Prüfe ob Router läuft...');

  // Prüfe Plugin-Port (3001)
  const pluginPortReady = await checkPort(CONFIG.PLUGIN_PORT);

  if (!pluginPortReady) {
    log('[MCP-V2] Router läuft nicht - starte Router...');
    await startRouter();
  } else {
    log('[MCP-V2] ✅ Router läuft bereits');
  }

  // Prüfe auch MCP-Port (4000)
  try {
    await waitForPort(CONFIG.ROUTER_PORT, 5000);
    log('[MCP-V2] ✅ Router MCP-Port bereit');
  } catch (e) {
    log(`[MCP-V2] ⚠️ Router MCP-Port nicht bereit: ${e.message}`);
  }
}

// ========== HEALTH CHECK + AUTO-RECOVERY ==========
async function ensureRouterConnection() {
  log('[MCP-V2] Health Check: Prüfe Router-Verbindung...');

  // 1. Prüfe ob Router-Port (4000) erreichbar ist
  const routerPortReady = await checkPort(CONFIG.ROUTER_PORT);

  if (!routerPortReady) {
    log('[MCP-V2] Health Check: Router-Port nicht erreichbar');

    // Router neu starten
    try {
      await startRouter();
    } catch (error) {
      throw new Error(`Router konnte nicht gestartet werden: ${error.message}`);
    }
  }

  // 2. WebSocket Verbindung prüfen/herstellen
  if (!isConnected || !routerWs || routerWs.readyState !== 1) {
    log('[MCP-V2] Health Check: WebSocket nicht verbunden - verbinde...');

    try {
      await connectToRouter();
      log('[MCP-V2] Health Check: ✅ WebSocket verbunden');
    } catch (error) {
      throw new Error(`WebSocket Verbindung fehlgeschlagen: ${error.message}`);
    }
  } else {
    log('[MCP-V2] Health Check: ✅ Bereits verbunden');
  }
}

// ========== ROUTER CONNECTION ==========
function connectToRouter() {
  return new Promise((resolve, reject) => {
    const routerUrl = `ws://localhost:${CONFIG.ROUTER_PORT}`;
    log(`[MCP-V2] Verbinde zu Router: ${routerUrl}`);
    
    routerWs = new WebSocket(routerUrl);
    
    routerWs.on('open', () => {
      log('[MCP-V2] WebSocket Verbindung zum Router hergestellt');
      
      // Registriere Agent
      const registerMsg = {
        type: 'register',
        agentId: AGENT_ID
      };
      routerWs.send(JSON.stringify(registerMsg));
      log(`[MCP-V2] Registriere Agent: ${AGENT_ID}`);
    });
    
    routerWs.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        handleRouterMessage(message, resolve);
      } catch (error) {
        log(`[MCP-V2] Parse-Fehler: ${error.message}`);
      }
    });
    
    routerWs.on('close', () => {
      log('[MCP-V2] Router Verbindung geschlossen');
      isConnected = false;
      
      // Reject alle pending requests
      for (const [id, pending] of pendingRequests.entries()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Router Verbindung verloren'));
      }
      pendingRequests.clear();
      
      // Versuche Reconnect
      scheduleReconnect();
    });
    
    routerWs.on('error', (error) => {
      log(`[MCP-V2] WebSocket Fehler: ${error.message}`);
      reject(error);
    });
  });
}

function handleRouterMessage(message, registrationResolve) {
  // Registrierungs-Bestätigung
  if (message.type === 'registered' && message.agentId === AGENT_ID) {
    log(`[MCP-V2] ✅ Agent registriert: ${message.agentId}`);
    isConnected = true;
    reconnectAttempts = 0;
    if (registrationResolve) registrationResolve(true);
    return;
  }
  
  // Result von Plugin
  if (message.type === 'result' && message.id) {
    const pending = pendingRequests.get(message.id);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingRequests.delete(message.id);

      // Base64 decodieren wenn encoded flag gesetzt
      let result = message.result;
      let error = message.error;

      if (message.encoded) {
        if (result) {
          result = Buffer.from(result, 'base64').toString('utf-8');
        }
        if (error) {
          error = Buffer.from(error, 'base64').toString('utf-8');
        }
      }

      if (error) {
        pending.reject(new Error(error));
      } else {
        pending.resolve(result);
      }
      log(`[MCP-V2] Result erhalten für Request ${message.id}`);
    }
    return;
  }
  
  // Ping/Pong
  if (message.type === 'ping') {
    routerWs.send(JSON.stringify({ type: 'pong' }));
    return;
  }
}

function scheduleReconnect() {
  if (reconnectAttempts >= CONFIG.MAX_RECONNECT_ATTEMPTS) {
    log(`[MCP-V2] Max Reconnect-Versuche erreicht (${CONFIG.MAX_RECONNECT_ATTEMPTS})`);
    return;
  }
  
  reconnectAttempts++;
  log(`[MCP-V2] Reconnect in ${CONFIG.RECONNECT_INTERVAL}ms (Versuch ${reconnectAttempts}/${CONFIG.MAX_RECONNECT_ATTEMPTS})`);
  
  setTimeout(async () => {
    try {
      await connectToRouter();
    } catch (e) {
      log(`[MCP-V2] Reconnect fehlgeschlagen: ${e.message}`);
    }
  }, CONFIG.RECONNECT_INTERVAL);
}

// ========== TOOL EXECUTION VIA ROUTER ==========
async function executeToolViaRouter(tool, args) {
  return new Promise((resolve, reject) => {
    if (!isConnected || !routerWs || routerWs.readyState !== 1) {
      reject(new Error('Nicht mit Router verbunden'));
      return;
    }
    
    const requestId = crypto.randomUUID();
    
    const command = {
      type: 'command',
      agentId: AGENT_ID,
      id: requestId,
      tool: tool,
      params: args
    };
    
    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Timeout: Keine Antwort vom Plugin nach ${CONFIG.TIMEOUT / 1000}s`));
    }, CONFIG.TIMEOUT);
    
    pendingRequests.set(requestId, { resolve, reject, timeout: timeoutId });
    
    try {
      routerWs.send(JSON.stringify(command));
      log(`[MCP-V2] Command gesendet: ${tool} (${requestId})`);
    } catch (error) {
      clearTimeout(timeoutId);
      pendingRequests.delete(requestId);
      reject(new Error(`WebSocket Send Error: ${error.message}`));
    }
  });
}

// ========== STRING ENCODING SYSTEM ==========
function unifiedEncode(str) {
  if (!str || typeof str !== 'string') return str;
  return Buffer.from(str, 'utf-8').toString('base64');
}

// ========== MCP SERVER SETUP ==========
const server = new Server(
  {
    name: 'roblox-studio-v2',
    version: '2.1.0-router',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ========== TOOL LIST (same as original) ==========
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'studio_status',
        description: 'Checks the current status of the Roblox Studio session.\nReturns "playtest" if a simulation is active, or "playtest stop" if in edit mode.\nUseful for checking if you are in the correct mode before executing context-sensitive commands.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'get_console_output',
        description: `Reads Console Output (Logs) from the game via LogService.
Shows logs since session start. Works in Studio AND Play-Test.

BEST PRACTICES:
- Call this AFTER playtest_control(action="start") to verify your code.
- Use filter='error' to quickly find bugs.
- Use filter='print' to see your debug messages.
- NOTE: If you just started a Play-Test, wait a moment before calling this to ensure scripts have run and errors are caught.`,
        inputSchema: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: 'Maximale Anzahl an Logs (neueste zuerst). Default: 50. Max: 200.' },
            filter: { type: 'string', description: "Filter-Typ: 'all', 'print', 'warning', 'error'. Default: 'all'" },
            search: { type: 'string', description: 'Suchstring - nur Logs die diesen Text enthalten' },
            context: { type: 'string', enum: ['studio', 'playtest_server', 'playtest_client'], description: 'Wo die Logs lesen. Default: playtest_server' },
          },
        },
      },
      {
        name: 'get_connection_info',
        description: 'Get the local IP address and WebSocket port for connecting the Roblox plugin.\nUse this to tell the user what IP and port to enter in the Roblox plugin settings.',
        inputSchema: { type: 'object', properties: {}, required: [] },
      },
      {
        name: 'playtest_control',
        description: `Starts or stops a Play-Test simulation.
Uses plugin:StartSimulation() and plugin:StopSimulation().
Only available in Studio context (Edit Mode).

DEBUGGING WORKFLOW (TEST-DRIVEN DEVELOPMENT):
1. Make changes to scripts (editScript/modifyObject).
2. Call playtest_control(action="start").
3. WAITING: The game needs a moment to start. Logs might not appear immediately.
4. In the NEXT turn (or after a delay): Call get_console_output() to check for errors.
5. Call playtest_control(action="stop") to fix bugs.`,
        inputSchema: {
          type: 'object',
          properties: {
            action: { type: 'string', enum: ['start', 'stop'], description: 'Aktion: "start" oder "stop"' },
          },
          required: ['action'],
        },
      },
      {
        name: 'tree',
        description: `Get the hierarchy tree of any Roblox object.
Use "depth" and "maxItems" to limit the output and save context window space.

GOOD USAGE:
- tree(path="workspace", depth=2, maxItems=20) -> ✅ EFFICIENT
- tree(path="workspace", depth="all") -> ❌ CAUTION (Might be too large)`,
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the Roblox object. Examples: "workspace", "workspace.Model"' },
            depth: { type: 'string', description: 'Depth level: 1, 2, 3... or "all" for unlimited depth' },
            maxItems: { type: 'string', description: 'Max items per level (default 50) or "all" for unlimited' },
            offset: { type: 'number', description: 'Start from item N (for pagination)' },
            count: { type: 'number', description: 'How many items to show' },
          },
          required: ['path'],
        },
      },
      {
        name: 'create',
        description: `Create a new Roblox object (Part, Script, Model, etc.).
Supports batch creation with loop variables.

LUA CODE RULES:
- The code runs in a sandbox where 'obj' is the newly created instance.
- You MUST use 'obj' to set properties. Example: "obj.Name = 'Test' obj.Transparency = 0.5" (NOT just "Transparency = 0.5").
- FOR SCRIPTS: If creating a Script/LocalScript via luaCode, set the source code using "obj.Source".
  Example: "obj.Source = 'print(\"Hello World\")'"

TIPS:
- Use "count" and "loopVars" to create multiple objects in ONE call.

GOOD USAGE EXAMPLE (Batch):
- create(count=10, loopVars={"i": {"start":1, "step":1}}, luaCode="obj.Name = 'Part_'..i obj.Position = Vector3.new(i*2, 0, 0)")`,
        inputSchema: {
          type: 'object',
          properties: {
            className: { type: 'string', description: 'The Roblox class name to create. Examples: "Part", "Script", "Model"' },
            name: { type: 'string', description: 'The name of the new object. Use {i} or $i for loop variable substitution in batch mode.' },
            parent: { type: 'string', description: 'Path to the parent object. Examples: "workspace", "game.ReplicatedStorage"' },
            luaCode: {
              type: 'string',
              description: 'Lua code to configure the object. Use "obj" to access the created object. Examples: "obj.Size = Vector3.new(4,4,4)\\nobj.Color = Color3.new(1,0,0)\\nobj.Anchored = true". Loop variables (e.g. "i") are available in batch mode.'
            },
            source: { type: 'string', description: 'Source code (for Script objects).' },
            count: { type: 'number', description: 'Optional: Create multiple instances (batch mode).' },
            loopVars: {
              type: 'object',
              description: 'Optional: Define loop variables for batch mode. Formats: {"i": "0..9"} (range), {"i": {"start": 0, "step": 2}}, or {"i": [0,1,2,3,...]} (array).'
            },
          },
          required: ['className', 'name', 'parent'],
        },
      },
      {
        name: 'get',
        description: 'Read properties and attributes from a Roblox object.\nReturns the values of the requested properties (e.g., Size, Position, Color).',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the Roblox object.' },
            attributes: { type: 'array', items: { type: 'string' }, description: 'Array of attribute/property names to read.' },
          },
          required: ['path', 'attributes'],
        },
      },
      {
        name: 'modifyObject',
        description: `Modify an existing Roblox object (properties, source, attributes).

CRITICAL - SCRIPT SOURCE EDITING RULES:
⚠️  Use modifyObject to change "source" parameter ONLY when replacing MORE THAN 50% of the script.
⚠️  For small changes (single lines, functions, variables), ALWAYS use editScript instead.
⚠️  modifyObject replaces the ENTIRE script source - all existing code is permanently lost!

WHEN TO USE modifyObject with source parameter:
✅ Complete script rewrite (creating new script from scratch).
✅ Changing more than 50% of existing code.
✅ Initial script content creation.

BAD USAGE EXAMPLE (DO NOT DO THIS):
- Task: "Change health to 200"
- Action: modifyObject(source="...entire 500 lines of code just to change one number...") -> ❌ WASTEFUL & DANGEROUS

GOOD USAGE EXAMPLE:
- Task: "Rewrite the entire movement system"
- Action: modifyObject(source="...new complete code...") -> ✅ CORRECT`,
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the Roblox object.' },
            luaCode: { type: 'string', description: 'Lua code for modifying properties and attributes.' },
            source: { type: 'string', description: 'Source code (for Script objects - replaces ENTIRE script source).' },
          },
          required: ['path'],
        },
      },
      {
        name: 'editScript',
        description: `Precise script editing with string replacement.

⚠️  MANDATORY: Use readLine() BEFORE editScript() to read target lines.

WORKFLOW:
1. readLine({path: "Script", startLine: 5, endLine: 10})
2. Find text you want to change in the output.
3. editScript({path: "Script", old_string: "old text", new_string: "new text"})
4. readLine() again to verify changes.

RULES:
- CRITICAL: old_string must match the file content BIT-BY-BIT. If readLine returns 4 spaces indentation, old_string MUST have 4 spaces. Do not trim or format.
- old_string must be from the readLine output (WITHOUT "Line X: " prefix).
- Use editScript for <50% changes, modifyObject for >50% rewrites.

BAD USAGE EXAMPLE:
- Task: Change "local x = 1"
- Action: editScript(old_string="local x=1") -> ❌ FAIL (Missing spaces/indentation)

GOOD USAGE EXAMPLE:
- Step 1: readLine returns "    local x = 1"
- Step 2: editScript(old_string="    local x = 1", new_string="    local x = 100") -> ✅ SUCCESS`,
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the script or object.' },
            old_string: { type: 'string', description: 'EXACT text to replace.' },
            new_string: { type: 'string', description: 'Replacement text.' },
            replace_all: { type: 'boolean', description: 'If true, replace ALL occurrences.' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
      {
        name: 'convertScript',
        description: 'Convert a script to another type (e.g., Script -> LocalScript) while preserving source, children, and attributes.\nUseful when refactoring server-side logic to client-side or vice versa.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the script to convert.' },
            targetType: { type: 'string', enum: ['Script', 'LocalScript', 'ModuleScript'], description: 'Target class name.' },
          },
          required: ['path', 'targetType'],
        },
      },
      {
        name: 'readLine',
        description: `Read specific lines from a script or object source.

WORKFLOW:
Use readLine() FIRST to analyze the current code, then make changes with deleteLines()/insertLines() or modifyObject(), then use readLine() again to VERIFY the changes worked correctly.

EXAMPLES:
1. Read a single line: { "path": "game.ReplicatedStorage.Script", "lineNumber": 10 }
2. Read a range: { "path": "game.ReplicatedStorage.Script", "startLine": 10, "endLine": 20 }`,
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the script or object.' },
            lineNumber: { type: 'number', description: 'Single line number to read.' },
            startLine: { type: 'number', description: 'Start line number for range reading.' },
            endLine: { type: 'number', description: 'End line number for range reading.' },
          },
          required: ['path'],
        },
      },
      {
        name: 'deleteLines',
        description: `Delete a range of lines from a script or object source.

WORKFLOW:
Use readLine() first to identify the lines to delete, then deleteLines(), then readLine() again to verify the deletion worked correctly.`,
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the script or object.' },
            startLine: { type: 'number', description: 'Starting line number to delete from' },
            endLine: { type: 'number', description: 'Ending line number to delete to' },
          },
          required: ['path', 'startLine', 'endLine'],
        },
      },
      {
        name: 'insertLines',
        description: `Insert new lines at a specific position in a script or object source.

BEHAVIOR:
insertLines(lineNumber=2) inserts new lines AT position 2. The original line 2 is pushed down to become line 3 (or later).

WORKFLOW:
Use readLine() first to identify the insertion point, then insertLines(), then readLine() again to verify.`,
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the script or object.' },
            lineNumber: { type: 'number', description: 'Line number where to insert the new lines.' },
            lines: { type: 'array', items: { type: 'string' }, description: 'Array of lines to insert.' },
          },
          required: ['path', 'lineNumber', 'lines'],
        },
      },
      {
        name: 'getScriptInfo',
        description: 'Get information about a script or object (line count, etc.).\nUseful for quick analysis before reading or editing.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the script or object.' },
          },
          required: ['path'],
        },
      },
      {
        name: 'scriptSearch',
        description: `Search for text across all scripts in the game.

WORKFLOW:
1. Use scriptSearch() to find code locations.
2. Use readLine() to examine the context around the match.
3. Use editScript() or modifyObject() to make changes.
4. Use readLine() to verify.`,
        inputSchema: {
          type: 'object',
          properties: {
            searchText: { type: 'string', description: 'Text to search for in scripts.' },
            caseSensitive: { type: 'boolean', description: 'Whether the search should be case sensitive (default: false)' },
            maxResults: { type: 'number', description: 'Maximum number of results to return (default: 50)' },
          },
          required: ['searchText'],
        },
      },
      {
        name: 'scriptSearchOnly',
        description: `Search for text in a specific script without replacing (read-only search).

WORKFLOW:
1. Use scriptSearchOnly() to find text within a known script.
2. Use readLine() to examine the context around the match.
3. Use editScript() or modifyObject() to make changes.`,
        inputSchema: {
          type: 'object',
          properties: {
            scriptPath: { type: 'string', description: 'Path to the script to search in.' },
            searchText: { type: 'string', description: 'Text to search for in scripts.' },
            caseSensitive: { type: 'boolean', description: 'Whether the search should be case sensitive (default: false)' },
            maxResults: { type: 'number', description: 'Maximum number of results to return (default: 50)' },
          },
          required: ['scriptPath', 'searchText'],
        },
      },
      {
        name: 'delete',
        description: 'Delete a Roblox object entirely.\nWARNING: This action is permanent and cannot be undone via this tool (unless you use undo in Studio).',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the Roblox object to delete.' },
          },
          required: ['path'],
        },
      },
      {
        name: 'copy',
        description: 'Copy a Roblox object to a new parent using Instance:Clone().\nCan optionally rename the copied object.',
        inputSchema: {
          type: 'object',
          properties: {
            sourcePath: { type: 'string', description: 'Path to the source object to copy.' },
            targetPath: { type: 'string', description: 'Path to the target parent.' },
            newName: { type: 'string', description: 'Optional new name for the copied object.' },
          },
          required: ['sourcePath', 'targetPath'],
        },
      },
      {
        name: 'executeCode',
        description: `Execute arbitrary Lua code in Studio OR Play-Test using ModuleScript proxy technique.
Use this for logic that doesn't persist (e.g., checking game state, temporary debugging).

CONTEXT:
- "studio": Runs in Edit Mode.
- "playtest_server": Runs on Server during Play.
- "playtest_client": Runs on Client during Play.`,
        inputSchema: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Lua code to execute.' },
            context: { type: 'string', enum: ['studio', 'playtest_server', 'playtest_client'], description: 'Where to execute. Default: studio' },
          },
          required: ['code'],
        },
      },
      {
        name: 'multi',
        description: `Execute multiple tool calls sequentially for complex workflows.
Unlimited tools per call! Use this to chain operations like:
1. create()
2. modifyObject()
3. readLine()
in a single turn to save time.`,
        inputSchema: {
          type: 'object',
          properties: {
            calls: {
              type: 'array',
              description: 'Array of tool calls to execute sequentially.',
              items: {
                type: 'object',
                properties: {
                  tool: { type: 'string', description: 'Tool name to call' },
                  args: { type: 'object', description: 'Arguments for the tool' },
                },
                required: ['tool', 'args'],
              },
            },
          },
          required: ['calls'],
        },
      },
    ],
  };
});

// ========== TOOL ARGUMENT PREPARATION ==========
function prepareToolArgs(tool, args) {
  const prepared = { ...args };
  
  if (tool === 'create') {
    if (prepared.luaCode) prepared.luaCode = unifiedEncode(prepared.luaCode);
    if (prepared.source) prepared.source = unifiedEncode(prepared.source);
  }
  if (tool === 'executeCode') {
    if (prepared.code) prepared.code = unifiedEncode(prepared.code);
  }
  if (tool === 'modifyObject') {
    if (prepared.luaCode) prepared.luaCode = unifiedEncode(prepared.luaCode);
    if (prepared.source) prepared.source = unifiedEncode(prepared.source);
  }
  if (tool === 'editScript') {
    if (prepared.old_string) prepared.old_string = unifiedEncode(prepared.old_string);
    if (prepared.new_string) prepared.new_string = unifiedEncode(prepared.new_string);
  }
  if (tool === 'insertLines' && prepared.lines && Array.isArray(prepared.lines)) {
    prepared.lines = prepared.lines.map(line => unifiedEncode(line));
  }
  
  return prepared;
}

// ========== TOOL HANDLERS ==========
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // GET CONNECTION INFO - Lokal (kein Router nötig)
    if (name === 'get_connection_info') {
      const interfaces = os.networkInterfaces();
      let localIp = 'localhost';

      for (const ifaceName of Object.keys(interfaces)) {
        for (const iface of interfaces[ifaceName]) {
          if (iface.family === 'IPv4' && !iface.internal) {
            localIp = iface.address;
            break;
          }
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            ip: localIp,
            port: CONFIG.PLUGIN_PORT,
            websocket_url: `ws://${localIp}:${CONFIG.PLUGIN_PORT}`,
            localhost_url: `ws://localhost:${CONFIG.PLUGIN_PORT}`,
            router_port: CONFIG.ROUTER_PORT,
            agent_id: AGENT_ID,
            instructions: 'Enter the IP and port in your Roblox plugin settings and click Connect'
          }, null, 2)
        }]
      };
    }

    // ========== HEALTH CHECK - Router Auto-Recovery ==========
    // Vor jedem Tool-Aufruf prüfen ob Router läuft
    try {
      await ensureRouterConnection();
    } catch (healthError) {
      log(`[MCP-V2] Health Check fehlgeschlagen: ${healthError.message}`);
      return {
        content: [{ type: 'text', text: `Error: ${healthError.message}` }],
        isError: true,
      };
    }

    // MULTI TOOL
    if (name === 'multi') {
      const { calls } = args;

      if (!Array.isArray(calls) || calls.length === 0) {
        return {
          content: [{ type: 'text', text: 'Error: Parameter "calls" muss ein nicht-leeres Array sein' }],
          isError: true,
        };
      }

      log(`[MCP-V2 MULTI] Processing ${calls.length} tool calls`);

      const results = [];

      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        const { tool, args: toolArgs } = call;

        try {
          log(`[MCP-V2 MULTI] Tool ${i + 1}/${calls.length}: ${tool}`);

          const context = toolArgs.context || 'studio';
          const preparedArgs = prepareToolArgs(tool, toolArgs);
          preparedArgs.context = context;

          const result = await executeToolViaRouter(tool, preparedArgs);

          results.push({
            index: i,
            tool,
            status: 'success',
            output: result
          });

          log(`[MCP-V2 MULTI] Tool ${i + 1}: ✅`);

        } catch (error) {
          log(`[MCP-V2 MULTI] Tool ${i + 1}: ❌ ${error.message}`);
          results.push({
            index: i,
            tool,
            status: 'error',
            error: error.message
          });
        }
      }

      let output = `=== Multi Tool Results (${results.length} calls) ===\n\n`;
      for (const result of results) {
        output += `[${result.index + 1}] ${result.tool.toUpperCase()}: `;
        if (result.status === 'success') {
          output += `✅ Success\n${result.output}\n\n`;
        } else {
          output += `❌ Error\n${result.error}\n\n`;
        }
      }

      const successCount = results.filter(r => r.status === 'success').length;
      const errorCount = results.filter(r => r.status === 'error').length;
      output += `Summary: ${successCount} succeeded, ${errorCount} failed`;

      return {
        content: [{ type: 'text', text: output }],
        isError: errorCount > 0,
      };
    }

    // SINGLE TOOL
    // playtest_control braucht keinen default context - Router setzt es automatisch
    let context;
    if (name === 'playtest_control') {
      context = args.context || null;  // Kein default - Router entscheidet
    } else {
      context = args.context || 'studio';
    }
    const preparedArgs = prepareToolArgs(name, args);
    if (context) {
      preparedArgs.context = context;
    }

    log(`[MCP-V2] Tool: ${name}, Context: ${context || 'auto'}`);

    const result = await executeToolViaRouter(name, preparedArgs);

    return {
      content: [{ type: 'text', text: result }],
    };

  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

// ========== CRASH PREVENTION ==========
process.on('uncaughtException', (error) => {
  log('[MCP-V2 ERROR] Uncaught Exception:', error.message);
  log('[MCP-V2 ERROR] Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  log('[MCP-V2 ERROR] Unhandled Rejection:', reason);
});

if (process.stdin.setDefaultEncoding) process.stdin.setDefaultEncoding('utf8');
if (process.stdout.setDefaultEncoding) process.stdout.setDefaultEncoding('utf8');

// ========== STARTUP ==========
async function main() {
  log('[MCP-V2] Starte MCP Server V2 mit Router-Unterstützung...');
  
  try {
    // 1. Stelle sicher dass Router läuft
    await ensureRouterRunning();
    
    // 2. Kurze Pause damit Router vollständig initialisiert ist
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 3. Verbinde zum Router
    await connectToRouter();
    
    log('[MCP-V2] ✅ Mit Router verbunden');
    
  } catch (error) {
    log(`[MCP-V2] ⚠️ Router-Verbindung fehlgeschlagen: ${error.message}`);
    log('[MCP-V2] Setze ohne Router fort (Fallback-Modus)');
  }
  
  // 4. Starte MCP Server (Stdio)
  log('[MCP-V2] Starte MCP Stdio Server...');
  
  const transport = new StdioServerTransport();
  server.connect(transport).then(() => {
    log('[MCP-V2] ✅ MCP Server V2 bereit');
    log(`[MCP-V2] Agent ID: ${AGENT_ID}`);
    log(`[MCP-V2] Router: ${isConnected ? 'verbunden' : 'nicht verbunden'}`);
    log(`[MCP-V2] Plugin Port: ${CONFIG.PLUGIN_PORT}`);
    log(`[MCP-V2] Router Port: ${CONFIG.ROUTER_PORT}`);
  }).catch((error) => {
    log('[MCP-V2 ERROR] Server start fehlgeschlagen:', error);
    process.exit(1);
  });
}

main();
