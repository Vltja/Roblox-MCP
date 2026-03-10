#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import crypto from 'crypto';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ========== LOGGING SYSTEM ==========
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, `mcp-server-${new Date().toISOString().slice(0, 10)}.log`);

// Create logs directory if it doesn't exist
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Log function that writes to both console and file
function log(message) {
  const timestamp = new Date().toISOString();
  const logLine = `[${timestamp}] ${message}`;

  // Write to stderr (console) - use console.error directly to avoid recursion
  console.error(logLine);

  // Append to log file
  try {
    fs.appendFileSync(LOG_FILE, logLine + '\n');
  } catch (e) {
    console.error('[LOG ERROR] Could not write to log file:', e.message);
  }
}

// Clear old logs (keep last 7 days)
function cleanOldLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const now = Date.now();
    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days

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
log(`[MCP] Log file: ${LOG_FILE}`);

// ========== CONFIGURATION ==========
const CONFIG = {
  TIMEOUT: 120000,             // 120s timeout for tool execution
  MAX_RESPONSE_SIZE: 50 * 1024 * 1024,  // 50MB max response
  WEBSOCKET_PORT: process.env.MCP_WS_PORT || 3001
};

log('[MCP WEBSOCKET] Roblox Studio MCP Server mit WebSocket startet...');
log(`[MCP WEBSOCKET] WebSocket Port: ${CONFIG.WEBSOCKET_PORT}`);
log(`[MCP WEBSOCKET] Timeout: ${CONFIG.TIMEOUT}ms`);

// ========== WEBSOCKET SERVER ==========
// Multi-Client Unterstützung: studio und playtest
let connectedClients = {
  studio: null,
  playtest: null,
  playtest_server: null,
  playtest_client: null
};
let pendingRequests = new Map(); // requestId -> { resolve, reject, timeout, context }

const httpServer = createServer();
const wss = new WebSocketServer({ server: httpServer });

// ========== DEBUG LOGGING FOR WEBSOCKET HANDSHAKE DIAGNOSIS ==========
// These handlers catch requests BEFORE the ws library processes them

// 1. Log ALL HTTP requests to the server
httpServer.on('request', (req, res) => {
  log('\n[DEBUG HTTP] ========== INCOMING HTTP REQUEST ==========');
  log(`[DEBUG HTTP] Method: ${req.method}`);
  log(`[DEBUG HTTP] URL: ${req.url}`);
  log(`[DEBUG HTTP] Remote Address: ${req.socket.remoteAddress}`);
  log('[DEBUG HTTP] Headers:', JSON.stringify(req.headers, null, 2));
  
  // Log response status when sent
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = function(statusCode, ...args) {
    log(`[DEBUG HTTP] Response Status: ${statusCode}`);
    return originalWriteHead(statusCode, ...args);
  };
});

// 2. Log WebSocket UPGRADE requests specifically (this fires BEFORE ws library)
httpServer.on('upgrade', (req, socket, head) => {
  log('\n[DEBUG UPGRADE] ========== WEBSOCKET UPGRADE REQUEST ==========');
  log(`[DEBUG UPGRADE] Method: ${req.method}`);
  log(`[DEBUG UPGRADE] URL: ${req.url}`);
  log(`[DEBUG UPGRADE] HTTP Version: ${req.httpVersion}`);
  log(`[DEBUG UPGRADE] Remote Address: ${req.socket.remoteAddress}`);
  log(`[DEBUG UPGRADE] Remote Port: ${req.socket.remotePort}`);
  log('[DEBUG UPGRADE] ========== ALL HEADERS ==========');
  for (const [key, value] of Object.entries(req.headers)) {
    log(`[DEBUG UPGRADE]   ${key}: ${value}`);
  }
  log('[DEBUG UPGRADE] ================================');
  
  // Log raw head buffer (contains any data sent before upgrade completes)
  log(`[DEBUG UPGRADE] Head buffer length: ${head ? head.length : 0}`);
  
  // Monitor socket errors during upgrade
  socket.on('error', (err) => {
    log(`[DEBUG UPGRADE] Socket Error during upgrade: ${err.message}`);
    log(`[DEBUG UPGRADE] Socket Error stack: ${err.stack}`);
  });
});

// 3. WebSocket Server error handling (catches protocol-level errors)
wss.on('error', (error) => {
  log('\n[DEBUG WSS] ========== WEBSOCKET SERVER ERROR ==========');
  log(`[DEBUG WSS] Error: ${error.message}`);
  log(`[DEBUG WSS] Error Code: ${error.code}`);
  log(`[DEBUG WSS] Stack: ${error.stack}`);
});

// 4. Log when ws library rejects a connection (headers event fires before connection)
wss.on('headers', (headers, req) => {
  log('\n[DEBUG WSS] ========== SENDING RESPONSE HEADERS ==========');
  log('[DEBUG WSS] Response Headers:', headers);
  log(`[DEBUG WSS] Request URL: ${req.url}`);
  log(`[DEBUG WSS] Request Headers Host: ${req.headers.host}`);
  log(`[DEBUG WSS] Upgrade: ${req.headers.upgrade}`);
  log(`[DEBUG WSS] Connection: ${req.headers.connection}`);
  log(`[DEBUG WSS] Sec-WebSocket-Key: ${req.headers['sec-websocket-key']}`);
  log(`[DEBUG WSS] Sec-WebSocket-Version: ${req.headers['sec-websocket-version']}`);
  log(`[DEBUG WSS] Sec-WebSocket-Protocol: ${req.headers['sec-websocket-protocol']}`);
  log(`[DEBUG WSS] Sec-WebSocket-Extensions: ${req.headers['sec-websocket-extensions']}`);
});

// 5. Log connection close during handshake
httpServer.on('close', () => {
  log('[DEBUG HTTP] HTTP Server closed');
});

httpServer.on('clientError', (exception, socket) => {
  log('\n[DEBUG HTTP] ========== CLIENT ERROR ==========');
  log(`[DEBUG HTTP] Exception: ${exception.message}`);
  log(`[DEBUG HTTP] Exception Code: ${exception.code}`);
  log(`[DEBUG HTTP] Remote Address: ${socket.remoteAddress}`);
});

log('[DEBUG] WebSocket debug logging enabled');
log('[DEBUG] Watch for [DEBUG UPGRADE] messages to see what Roblox is sending');
log('[DEBUG] Watch for [DEBUG WSS] messages to see what the ws library responds');


wss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  log(`[MCP WEBSOCKET] Neue Verbindung von: ${clientIp}`);

  // Client Context wird per register message gesetzt
  let clientContext = null;

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      log(`[MCP WEBSOCKET] Nachricht empfangen: ${message.type}`);

      // Client registriert sich mit Context
      if (message.type === 'register' && message.context) {
        clientContext = message.context;
        connectedClients[clientContext] = ws;
        log(`[MCP WEBSOCKET] Client registriert als: ${clientContext}`);

        // Bestätigung senden
        ws.send(JSON.stringify({ type: 'registered', context: clientContext }));
        return;
      }

      if (message.type === 'result' && message.id) {
        // Result from plugin
        const pending = pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingRequests.delete(message.id);

          if (message.error) {
            pending.reject(new Error(message.error));
          } else {
            pending.resolve(message.result);
          }
        }
      } else if (message.type === 'pong') {
        // Keepalive response
        log('[MCP WEBSOCKET] Pong empfangen');
      }
    } catch (error) {
      log(`[MCP WEBSOCKET] Parse-Fehler: ${error.message}`);
    }
  });

  ws.on('close', () => {
    log(`[MCP WEBSOCKET] Client getrennt: ${clientContext || 'unregistriert'}`);
    if (clientContext && connectedClients[clientContext] === ws) {
      connectedClients[clientContext] = null;
    }

    // Reject pending requests for this context
    for (const [id, pending] of pendingRequests.entries()) {
      if (!clientContext || pending.context === clientContext) {
        clearTimeout(pending.timeout);
        pendingRequests.delete(id);
        pending.reject(new Error('Plugin disconnected'));
      }
    }
  });

  ws.on('error', (error) => {
    log(`[MCP WEBSOCKET] WebSocket Fehler: ${error.message}`);
  });

  // Send initial ping (delayed to allow Roblox client to finish handshake)
  setTimeout(() => {
    if (ws.readyState === 1) { // 1 = OPEN
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 100);
});

// Start WebSocket Server
httpServer.listen(CONFIG.WEBSOCKET_PORT, () => {
  log(`[MCP WEBSOCKET] ✅ WebSocket Server läuft auf Port ${CONFIG.WEBSOCKET_PORT}`);
});

// Keepalive Interval (every 30s) - für alle verbundenen Clients
setInterval(() => {
  for (const [context, client] of Object.entries(connectedClients)) {
    if (client && client.readyState === 1) {
      client.send(JSON.stringify({ type: 'ping' }));
    }
  }
}, 30000);

// ========== STRING ENCODING SYSTEM ==========
function unifiedEncode(str) {
  if (!str || typeof str !== 'string') return str;

  try {
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (base64Regex.test(str) && str.length >= 4) {
      try {
        const decoded = Buffer.from(str, 'base64').toString('utf-8');
        if (decoded && decoded !== str) {
          return str;
        }
      } catch (e) {}
    }

    return Buffer.from(str, 'utf-8').toString('base64');
  } catch (error) {
    log('[Base64] Encode error:', error.message);
    return str;
  }
}

function unifiedDecode(str) {
  if (!str || typeof str !== 'string') return str;

  if (str.startsWith('✅') || str.startsWith('[SUCCESS]') ||
      str.startsWith('[ERROR]') || str.startsWith('[DEBUG]') ||
      str.startsWith('[INFO]') || str.startsWith('[WARNING]')) {
    return str;
  }

  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(str) || str.length < 4) {
    return str;
  }

  try {
    const decoded = Buffer.from(str, 'base64').toString('utf-8');

    if (!decoded || decoded.length === 0) {
      console.warn('[Base64] Decode resulted in empty string, returning original');
      return str;
    }

    return decoded;
  } catch (error) {
    log('[Base64] Decode error:', error.message);
    return str;
  }
}

// ========== WEBSOCKET TOOL EXECUTION ==========
async function executeToolViaWebSocket(tool, args, context = 'studio') {
  return new Promise((resolve, reject) => {
    const client = connectedClients[context];

    if (!client || client.readyState !== 1) {
      if (context === 'playtest_server' || context === 'playtest_client') {
        reject(new Error(`${context} nicht verbunden. Starte einen Play-Test um diesen Context zu nutzen.`));
      } else {
        reject(new Error('Roblox Plugin nicht verbunden. Bitte verbinden Sie das Plugin zuerst.'));
      }
      return;
    }

    const requestId = crypto.randomUUID();

    const command = {
      type: 'command',
      id: requestId,
      tool: tool,
      params: args
    };

    const timeoutId = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error(`Timeout: Keine Antwort vom ${context} Plugin nach ${CONFIG.TIMEOUT / 1000}s`));
    }, CONFIG.TIMEOUT);

    pendingRequests.set(requestId, { resolve, reject, timeout: timeoutId, context });

    try {
      client.send(JSON.stringify(command));
      log(`[MCP WEBSOCKET] Command gesendet: ${tool} (${requestId}) an ${context}`);
    } catch (error) {
      clearTimeout(timeoutId);
      pendingRequests.delete(requestId);
      reject(new Error(`WebSocket Send Error: ${error.message}`));
    }
  });
}

// ========== MCP SERVER SETUP ==========
const server = new Server(
  {
    name: 'roblox-studio',
    version: '2.0.0-websocket',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ========== TOOL LIST ==========
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'studio_status',
        description: 'Zeigt den Status des Play-Tests. Gibt "playtest" zurück wenn ein Play-Test aktiv ist, oder "playtest stop" wenn kein Play-Test läuft. Die Logik ist im MCP Server - keine Plugin-Kommunikation nötig.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'get_console_output',
        description: 'Liest Console-Output (Logs) aus dem Spiel via LogService. Zeigt alle Logs seit Session-Start. Funktioniert in Studio UND Play-Test.',
        inputSchema: {
          type: 'object',
          properties: {
            limit: {
              type: 'number',
              description: 'Maximale Anzahl an Logs (neueste zuerst). Default: 50. Max: 200.',
            },
            filter: {
              type: 'string',
              description: "Filter-Typ: 'all', 'print', 'warning', 'error'. Default: 'all'",
            },
            search: {
              type: 'string',
              description: 'Suchstring - nur Logs die diesen Text enthalten',
            },
            context: {
              type: 'string',
              enum: ['studio', 'playtest_server', 'playtest_client'],
              description: 'Wo die Logs lesen: "studio" (Edit-Modus), "playtest_server" (Server), "playtest_client" (Client). Default: playtest_server',
            },
          },
        },
      },
      {
        name: 'get_connection_info',
        description: 'Get the local IP address and WebSocket port for connecting the Roblox plugin. Use this to tell the user what IP and port to enter in the Roblox plugin settings.',
        inputSchema: {
          type: 'object',
          properties: {},
          required: [],
        },
      },
      {
        name: 'playtest_control',
        description: 'Startet oder stoppt einen Play-Test. Nutzt plugin:StartSimulation() und plugin:StopSimulation(). Nur im Studio Context verfügbar.',
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['start', 'stop'],
              description: 'Aktion: "start" startet Play-Test (wie F5), "stop" beendet Play-Test (wie Shift+F5)',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'tree',
        description: 'Get the hierarchy tree of any Roblox object with pagination and depth control.\n\nParameters:\n- path: Object path (e.g. "workspace")\n- depth: Number of levels (1, 2, 3...) or "all" for unlimited\n- maxItems: Max items per level (default 50) or "all"\n- offset: Start from item N (for pagination)\n- count: How many items to show\n\nExamples:\n- tree workspace → Basic view\n- tree workspace depth=2 → 2 levels\n- tree workspace depth=all maxItems=all → Everything\n- tree workspace offset=20 count=20 → Items 21-40',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the Roblox object. Examples: "workspace", "workspace.Model", "game.ReplicatedStorage"',
            },
            depth: {
              type: 'string',
              description: 'Depth level: 1, 2, 3... or "all" for unlimited depth',
            },
            maxItems: {
              type: 'string',
              description: 'Max items per level (default 50) or "all" for unlimited',
            },
            offset: {
              type: 'number',
              description: 'Start from item N (for pagination)',
            },
            count: {
              type: 'number',
              description: 'How many items to show',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'create',
        description: 'Create a new Roblox object (Part, Script, Model, etc.). The source parameter accepts multi-line strings with ALL characters preserved exactly (Base64-encoded internally for safe transport).',
        inputSchema: {
          type: 'object',
          properties: {
            className: {
              type: 'string',
              description: 'The Roblox class name to create. Examples: "Part", "Script", "Model"',
            },
            name: {
              type: 'string',
              description: 'The name of the new object',
            },
            parent: {
              type: 'string',
              description: 'Path to the parent object. Examples: "workspace", "game.ReplicatedStorage"',
            },
            properties: {
              type: 'object',
              description: 'Properties to set on the object. Supports: Vector3 as "x, y, z", Color3 as "r, g, b" (0-255), Boolean as "true"/"false", Numbers, Strings. Example: {"Size": "10, 2, 10", "Anchored": "true", "Transparency": "0.5"}',
            },
            attributes: {
              type: 'object',
              description: 'Custom attributes to set on the object. Example: {"Health": 100, "Damage": 25, "Owner": "Player1"}',
            },
            luaCode: {
              type: 'string',
              description: 'Lua code for complex property/attribute operations. Uses ModuleScript proxy. Example: "obj.Size = Vector3.new(10,2,10) obj.Anchored = true obj:SetAttribute(\'Health\', 100)". (Base64-encoded internally for safe JSON transport)',
            },
            source: {
              type: 'string',
              description: 'Source code (for Script objects - ONLY use if className is a Script type like "Script", "LocalScript", "ModuleScript"). ALL characters are preserved exactly as provided. Use real newlines for line breaks, use \\n within strings when you want Lua to interpret it as an escape sequence. (Base64-encoded internally for safe JSON transport)',
            },
            count: {
              type: 'number',
              description: 'Optional: Create multiple instances (batch mode). Example: 10 to create 10 objects.',
            },
            loopVars: {
              type: 'object',
              description: 'Optional: Define loop variables for batch mode. Keys are variable names, values are objects with "start" and "step". Example: {"x": {"start": 0, "step": 2}, "rot": {"start": 0, "step": 15}}. These variables can be used in "properties" values.',
            },
          },
          required: ['className', 'name', 'parent'],
        },
      },
      {
        name: 'get',
        description: 'Read properties and attributes from a Roblox object.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the Roblox object. Examples: "workspace.Part1", "game.ReplicatedStorage.Script"',
            },
            attributes: {
              type: 'array',
              description: 'Array of attribute/property names to read. Examples: ["Size", "Color", "Anchored"]',
              items: {
                type: 'string',
              },
            },
          },
          required: ['path', 'attributes'],
        },
      },
      {
        name: 'modifyObject',
        description: `Modify an existing Roblox object (properties, source, attributes).\n\nCRITICAL - Script Source Editing:\n⚠️  Use modifyObject to change "source" parameter ONLY when replacing MORE THAN 50% of the script\n⚠️  For small changes (single lines, functions, variables), ALWAYS use editScript instead\n⚠️  modifyObject replaces the ENTIRE script source - all existing code is permanently lost!\n\nWHEN TO USE modifyObject with source parameter:\n✅ Complete script rewrite (creating new script from scratch)\n✅ Changing more than 50% of existing code\n✅ Initial script content creation\n\nWHEN TO USE editScript instead:\n✅ Changing single lines or specific functions (< 50% of code)\n✅ Updating specific variables, strings, or values\n✅ Modifying parts of code while preserving the rest\n✅ Any targeted change that doesn\'t require full rewrite\n\nFor properties and attributes:\n✅ Use luaCode parameter with obj. assignments for maximum flexibility\n✅ Supports all Roblox data types automatically`,
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the Roblox object. Examples: "workspace.Part1", "game.ReplicatedStorage.Script"',
            },
            luaCode: {
              type: 'string',
              description: 'Lua code for modifying properties and attributes. Only obj. and obj:SetAttribute() allowed. Example: "obj.Size = Vector3.new(10,2,10)\\nobj.Transparency = 0.5\\nobj:SetAttribute(\\"MaxHealth\\", 500)". (Base64-encoded internally for safe JSON transport)',
            },
            source: {
              type: 'string',
              description: 'Source code (for Script objects - replaces ENTIRE script source). IMPORTANT: This completely replaces the script content. ALL characters are preserved exactly as provided. Use real newlines for line breaks, use \\n within strings when you want Lua to interpret it as an escape sequence. (Base64-encoded internally for safe JSON transport)',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'editScript',
        description: `Precise script editing with string replacement.\n\n⚠️  MANDATORY: Use readLine() BEFORE editScript() to read target lines\n\nWORKFLOW:\n1. readLine({path: "Script", startLine: 5, endLine: 10})\n2. Find text you want to change in the output\n3. editScript({path: "Script", old_string: "old text", new_string: "new text"})\n4. readLine() again to verify changes\n\nRULES:\n- CRITICAL: old_string must match the file content BIT-BY-BIT. If readLine returns 4 spaces indentation, old_string MUST have 4 spaces. Do not trim or format.\n- old_string must be from the readLine output (WITHOUT "Line X: " prefix)\n- Use real newlines for line breaks, use \\n within strings when you want Lua to interpret it as an escape sequence\n- Use editScript for <50% changes, modifyObject for >50% rewrites\n- (Base64-encoded internally for safe JSON transport)\n\nEXAMPLE:\n{\n  "path": "game.ReplicatedStorage.Script",\n  "old_string": "local x = 1",\n  "new_string": "local x = 999"\n}`,
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the script or object. Examples: "game.ReplicatedStorage.Script", "workspace.Part.Script"',
            },
            old_string: {
              type: 'string',
              description: 'EXACT text to replace (copy from readLine output WITHOUT "Line X: " prefix). CRITICAL: Must match content BIT-BY-BIT including exact indentation. Do not trim. (Base64-encoded internally)',
            },
            new_string: {
              type: 'string',
              description: 'Replacement text. (Base64-encoded internally)',
            },
            replace_all: {
              type: 'boolean',
              description: 'If true, replace ALL occurrences of old_string. If false (default), old_string must be unique or an error is thrown.',
            },
          },
          required: ['path', 'old_string', 'new_string'],
        },
      },
      {
        name: 'convertScript',
        description: 'Convert a script to another type (e.g., Script -> LocalScript) while preserving source, children, and attributes.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the script to convert. Example: "game.ServerScriptService.MyScript"',
            },
            targetType: {
              type: 'string',
              description: 'Target class name. Must be one of: "Script", "LocalScript", "ModuleScript".',
              enum: ['Script', 'LocalScript', 'ModuleScript']
            },
          },
          required: ['path', 'targetType'],
        },
      },
      {
        name: 'readLine',
        description: `Read specific lines from a script or object source. WORKFLOW: Use readLine() first to analyze the current code, then make changes with deleteLines()/insertLines() or modifyObject(), then use readLine() again to verify the changes worked correctly.\n\nEXAMPLES:\n1. Read a single line:\n{\n  "path": "game.ReplicatedStorage.Script",\n  "lineNumber": 10\n}\n\n2. Read a range of lines:\n{\n  "path": "game.ReplicatedStorage.Script",\n  "startLine": 10,\n  "endLine": 20\n}`,
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the script or object. Examples: "game.ReplicatedStorage.Script"',
            },
            lineNumber: {
              type: 'number',
              description: 'Single line number to read (alternative to startLine/endLine)',
            },
            startLine: {
              type: 'number',
              description: 'Start line number for range reading (use with endLine)',
            },
            endLine: {
              type: 'number',
              description: 'End line number for range reading (use with startLine)',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'deleteLines',
        description: 'Delete a range of lines from a script or object source. WORKFLOW: Use readLine() first to identify the lines to delete, then deleteLines(), then readLine() again to verify the deletion worked correctly.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the script or object. Examples: "game.ReplicatedStorage.Script"',
            },
            startLine: {
              type: 'number',
              description: 'Starting line number to delete from',
            },
            endLine: {
              type: 'number',
              description: 'Ending line number to delete to',
            },
          },
          required: ['path', 'startLine', 'endLine'],
        },
      },
      {
        name: 'insertLines',
        description: 'Insert new lines at a specific position in a script or object source. The lines are inserted AT the specified lineNumber position, pushing the original line at that position down (like pressing Enter in an editor). BEHAVIOR: insertLines(lineNumber=2) inserts new lines at position 2, moving the original line 2 down to become line 3 (or later, depending on how many lines are inserted). WORKFLOW: Use readLine() first to identify the insertion point, then insertLines(), then readLine() again to verify the insertion worked correctly.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the script or object. Examples: "game.ReplicatedStorage.Script"',
            },
            lineNumber: {
              type: 'number',
              description: 'Line number where to insert the new lines. The original line at this position will be pushed down. Example: lineNumber=2 means the new lines will be inserted at position 2, and the original line 2 becomes line 3 (or later).',
            },
            lines: {
              type: 'array',
              description: 'Array of lines to insert. ALL characters in each line are preserved exactly as provided. (Each line Base64-encoded internally for safe JSON transport)',
              items: {
                type: 'string',
              },
            },
          },
          required: ['path', 'lineNumber', 'lines'],
        },
      },
      {
        name: 'getScriptInfo',
        description: 'Get information about a script or object (line count, etc.).',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the script or object. Examples: "game.ReplicatedStorage.Script"',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'scriptSearch',
        description: 'Search for text across all scripts in the game. WORKFLOW: Use scriptSearch() to find code locations, then readLine() to examine the context, then use modifyObject() or deleteLines()/insertLines() to make changes, then readLine() to verify.',
        inputSchema: {
          type: 'object',
          properties: {
            searchText: {
              type: 'string',
              description: 'Text to search for in scripts',
            },
            caseSensitive: {
              type: 'boolean',
              description: 'Whether the search should be case sensitive (default: false)',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results to return (default: 50)',
            },
          },
          required: ['searchText'],
        },
      },
      {
        name: 'scriptSearchOnly',
        description: 'Search for text in a specific script without replacing (read-only search). WORKFLOW: Use scriptSearchOnly() to find specific text in one script, then readLine() to examine context, then use modifyObject() or deleteLines()/insertLines() to make changes, then readLine() to verify.',
        inputSchema: {
          type: 'object',
          properties: {
            scriptPath: {
              type: 'string',
              description: 'Path to the script to search in. Examples: "game.ReplicatedStorage.Script"',
            },
            searchText: {
              type: 'string',
              description: 'Text to search for in scripts',
            },
            caseSensitive: {
              type: 'boolean',
              description: 'Whether the search should be case sensitive (default: false)',
            },
            maxResults: {
              type: 'number',
              description: 'Maximum number of results to return (default: 50)',
            },
          },
          required: ['scriptPath', 'searchText'],
        },
      },
        {
        name: 'delete',
        description: 'Delete a Roblox object entirely.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the Roblox object to delete. Examples: "workspace.Part1", "game.ReplicatedStorage.OldScript"',
            },
          },
          required: ['path'],
        },
      },
      {
        name: 'copy',
        description: 'Copy a Roblox object to a new parent using Instance:Clone().',
        inputSchema: {
          type: 'object',
          properties: {
            sourcePath: {
              type: 'string',
              description: 'Path to the source object to copy. Examples: "workspace.Model1", "game.ReplicatedStorage.Script"',
            },
            targetPath: {
              type: 'string',
              description: 'Path to the target parent. Examples: "workspace", "game.ReplicatedStorage.Folder"',
            },
            newName: {
              type: 'string',
              description: 'Optional new name for the copied object. If not provided, keeps original name.',
            },
          },
          required: ['sourcePath', 'targetPath'],
        },
      },
      {
        name: 'executeCode',
        description: 'Execute arbitrary Lua code in Studio OR Play-Test using ModuleScript proxy technique. Creates temporary modules in ServerStorage/ScriptExecutor with timestamp names. Auto-cleanup after 30 modules. Use for complex operations like loops, conditionals, etc. Use context="playtest_server" for server-side or context="playtest_client" for client-side execution.',
        inputSchema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Lua code to execute. Example: "for i = 1, 10 do local part = Instance.new(\'Part\') part.Position = Vector3.new(i*2, 0, 0) part.Parent = workspace end"',
            },
            context: {
              type: 'string',
              enum: ['studio', 'playtest_server', 'playtest_client'],
              description: 'Where to execute: "studio" (Edit-Modus), "playtest_server" (Server), "playtest_client" (Client). Default: studio',
            },
          },
          required: ['code'],
        },
      },
      {
        name: 'multi',
        description: 'Execute multiple tool calls sequentially for complex workflows. Unlimited tools per call - no limits! Available tools: tree, create, get, modifyObject, editScript, copy, readLine, deleteLines, insertLines, getScriptInfo, scriptSearch, scriptSearchOnly, delete, executeCode',
        inputSchema: {
          type: 'object',
          properties: {
            calls: {
              type: 'array',
              description: 'Array of tool calls to execute sequentially.',
              items: {
                type: 'object',
                properties: {
                  tool: {
                    type: 'string',
                    description: 'Tool name to call: "tree", "create", "get", "modifyObject", "editScript", "copy", "readLine", "deleteLines", "insertLines", "getScriptInfo", "scriptSearch", "scriptSearchOnly", "delete", "executeCode"',
                  },
                  args: {
                    type: 'object',
                    description: 'Arguments for the tool (same as calling the tool directly)',
                  },
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

// ========== TOOL HANDLER HELPER ==========
function prepareToolArgs(tool, args) {
  // Create deep copy
  const prepared = { ...args };
  
  // Encode specific parameters for script-related tools
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
    // STUDIO STATUS - Play-Test Status prüfen (MCP Server Logik)
    if (name === 'studio_status') {
      const playTestActive = (connectedClients.playtest !== null && connectedClients.playtest.readyState === 1) ||
                              (connectedClients.playtest_server !== null && connectedClients.playtest_server.readyState === 1);
      const status = playTestActive ? 'playtest' : 'playtest stop';

      log(`[MCP] studio_status: ${status}`);

      return {
        content: [{
          type: 'text',
          text: status
        }]
      };
    }

    // GET CONSOLE OUTPUT - Read logs from LogService
    if (name === 'get_console_output') {
      const context = args.context || 'playtest_server';

      // Check if target client is connected
      const targetClient = connectedClients[context];
      if (!targetClient || targetClient.readyState !== 1) {
        const statusMsg = context === 'playtest_server'
          ? 'Play-Test Server nicht aktiv.'
          : context === 'playtest_client'
            ? 'Play-Test Client nicht aktiv.'
            : 'Studio Client nicht verbunden.';
        return {
          content: [{
            type: 'text',
            text: `[ERROR] ${statusMsg}`
          }]
        };
      }

      // Send command to plugin
      return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();

        const timeout = setTimeout(() => {
          pendingRequests.delete(requestId);
          reject(new Error('Timeout: Plugin antwortet nicht'));
        }, CONFIG.TIMEOUT);

        pendingRequests.set(requestId, {
          resolve: (result) => {
            clearTimeout(timeout);
            pendingRequests.delete(requestId);
            resolve({
              content: [{
                type: 'text',
                text: result
              }]
            });
          },
          reject: (error) => {
            clearTimeout(timeout);
            pendingRequests.delete(requestId);
            reject(error);
          },
          context: context
        });

        // Send command to target client
        const message = {
          type: 'command',
          id: requestId,
          tool: 'getConsoleOutput',
          params: {
            limit: args.limit || 50,
            filter: args.filter || 'all',
            search: args.search || ''
          }
        };

        log(`[MCP] Sending getConsoleOutput to ${context} client`);
        targetClient.send(JSON.stringify(message));
      });
    }

    // GET CONNECTION INFO - Return IP and Port for plugin connection
    if (name === 'get_connection_info') {
      // os already imported at top
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
            port: 3001,
            websocket_url: `ws://${localIp}:3001`,
            localhost_url: 'ws://localhost:3001',
            instructions: 'Enter the IP and port in your Roblox plugin settings and click Connect'
          }, null, 2)
        }]
      };
    }

    // PLAYTEST CONTROL - Start/Stop Play-Test
    if (name === 'playtest_control') {
      const action = args.action;

      if (!action || !['start', 'stop'].includes(action)) {
        return {
          content: [{
            type: 'text',
            text: '[ERROR] Ungültige Aktion. Nutze "start" oder "stop"'
          }]
        };
      }

      // START: Send to studio client
      // STOP: Send to playtest_server client (via MCP routing!)
      const targetContext = action === 'start' ? 'studio' : 'playtest_server';
      const targetClient = connectedClients[targetContext];

      if (!targetClient || targetClient.readyState !== 1) {
        const errorMsg = action === 'start'
          ? '[ERROR] Studio nicht verbunden. Verbinde zuerst das Plugin im Studio.'
          : '[ERROR] Play-Test Server nicht aktiv. Starte zuerst einen Play-Test.';
        return {
          content: [{
            type: 'text',
            text: errorMsg
          }]
        };
      }

      // Send command to target client
      return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();

        const timeout = setTimeout(() => {
          pendingRequests.delete(requestId);
          reject(new Error('Timeout: Plugin antwortet nicht'));
        }, CONFIG.TIMEOUT);

        pendingRequests.set(requestId, {
          resolve: (result) => {
            clearTimeout(timeout);
            pendingRequests.delete(requestId);
            resolve({
              content: [{
                type: 'text',
                text: result
              }]
            });
          },
          reject: (error) => {
            clearTimeout(timeout);
            pendingRequests.delete(requestId);
            reject(error);
          },
          context: targetContext
        });

        const message = {
          type: 'command',
          id: requestId,
          tool: 'playtestControl',
          params: { action: action }
        };

        log(`[MCP] Sending playtestControl ${action} to ${targetContext} client`);
        targetClient.send(JSON.stringify(message));
      });
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

      log(`[MCP MULTI] Processing ${calls.length} tool calls`);

      const results = [];

      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        const { tool, args: toolArgs } = call;

        try {
          log(`[MCP MULTI] Tool ${i + 1}/${calls.length}: ${tool}`);

          // Context extrahieren (default: studio)
          const context = toolArgs.context || 'studio';
          const preparedArgs = prepareToolArgs(tool, toolArgs);
          delete preparedArgs.context;

          const result = await executeToolViaWebSocket(tool, preparedArgs, context);

          results.push({
            index: i,
            tool,
            status: 'success',
            output: result
          });

          log(`[MCP MULTI] Tool ${i + 1}: ✅`);

        } catch (error) {
          log(`[MCP MULTI] Tool ${i + 1}: ❌ ${error.message}`);
          results.push({
            index: i,
            tool,
            status: 'error',
            error: error.message
          });
        }
      }

      // Format combined output
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
    // Context extrahieren (default: studio)
    const context = args.context || 'studio';
    const preparedArgs = prepareToolArgs(name, args);
    // Context nicht an Plugin senden (nur für Routing)
    delete preparedArgs.context;

    // DEBUG: Log connected clients
    log(`[MCP DEBUG] Tool: ${name}, Context: ${context}`);
    log(`[MCP DEBUG] Connected Clients:`);
    for (const [ctx, client] of Object.entries(connectedClients)) {
      log(`[MCP DEBUG]   ${ctx}: ${client ? `connected (readyState=${client.readyState})` : 'null'}`);
    }

    const result = await executeToolViaWebSocket(name, preparedArgs, context);

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
  log('[MCP ERROR] Uncaught Exception:', error.message);
  log('[MCP ERROR] Stack:', error.stack);
  // Don't exit - try to recover
});

process.on('unhandledRejection', (reason, promise) => {
  log('[MCP ERROR] Unhandled Rejection:', reason);
  // Don't exit - keep server running
});

// Safe encoding
if (process.stdin.setDefaultEncoding) process.stdin.setDefaultEncoding('utf8');
if (process.stdout.setDefaultEncoding) process.stdout.setDefaultEncoding('utf8');

// ========== START MCP SERVER ==========
log('[MCP WEBSOCKET] Starte MCP Server mit WebSocket...');

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  log('✅ MCP Server bereit (WebSocket Mode)');
  log(`[MCP WEBSOCKET] Plugin verbinden zu: ws://localhost:${CONFIG.WEBSOCKET_PORT}`);
}).catch((error) => {
  log('[MCP ERROR] Server start fehlgeschlagen:', error);
  process.exit(1);
});
