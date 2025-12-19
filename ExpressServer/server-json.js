import express from 'express';
import bodyParser from 'body-parser';
import crypto from 'crypto';
import { createServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'fs';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const settingsPath = path.join(__dirname, 'settings.json');
const LOG_FILE_PATH = path.join(__dirname, 'server_debug.log');
const ENABLE_FILE_LOGGING = false; // Setze auf true, um in server_debug.log zu schreiben

// ========== LOGGING SYSTEM ========== 
// Log file leeren beim Start (nur wenn aktiviert)
if (ENABLE_FILE_LOGGING) {
  try {
    writeFileSync(LOG_FILE_PATH, `=== SERVER START: ${new Date().toISOString()} ===\n`);
  } catch (e) {}
}

function logToFile(msg) {
  if (!ENABLE_FILE_LOGGING) return;
  
  try {
    const timestamp = new Date().toISOString();
    // Prüfe ob msg ein Objekt ist
    const line = (typeof msg === 'object') ? JSON.stringify(msg) : String(msg);
    appendFileSync(LOG_FILE_PATH, `[${timestamp}] ${line}\n`);
  } catch (e) {
    // Fail silent
  }
}

// Console Overrides
const originalConsoleLog = console.log;
const originalConsoleError = console.error;

console.log = function(...args) {
  const msg = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
  logToFile(`[INFO] ${msg}`);
  originalConsoleLog.apply(console, args);
};

console.error = function(...args) {
  const msg = args.map(arg => (typeof arg === 'object' ? JSON.stringify(arg) : String(arg))).join(' ');
  logToFile(`[ERROR] ${msg}`);
  originalConsoleError.apply(console, args);
};

// ========== Dependency Check & Auto-Install ========== 
function checkAndInstallDependencies() {
  const requiredPackages = [
    'express',
    'body-parser',
    'socket.io'
  ];

  console.log('='.repeat(60));
  console.log('🔍 Roblox Studio API Server - Dependency Check');
  console.log('='.repeat(60));

  const projectRoot = path.join(__dirname, '..');
  const nodeModulesPath = path.join(projectRoot, 'node_modules');

  let needsInstall = false;
  const missingPackages = [];

  // Pruefe ob node_modules existiert
  if (!existsSync(nodeModulesPath)) {
    console.log('⚠️  node_modules nicht gefunden - starte Installation...');
    needsInstall = true;
  } else {
    // Pruefe jedes benoetigte Paket
    for (const pkg of requiredPackages) {
      const pkgPath = path.join(nodeModulesPath, pkg);
      if (!existsSync(pkgPath)) {
        console.log(`❌ Paket fehlt: ${pkg}`);
        missingPackages.push(pkg);
        needsInstall = true;
      } else {
        console.log(`✅ Paket gefunden: ${pkg}`);
      }
    }
  }

  // Installiere Dependencies wenn noetig
  if (needsInstall) {
    console.log('\n🔧 Installiere fehlende Dependencies...');
    console.log('Dies kann einige Minuten dauern...\n');

    try {
      // Wechsle zum Projektverzeichnis und installiere
      process.chdir(projectRoot);
      execSync('npm install', { stdio: 'inherit' });

      console.log('\n✅ Installation erfolgreich!');
      console.log('Alle Dependencies sind jetzt vorhanden.\n');

      // Pruefe erneut ob alles installiert wurde
      let allInstalled = true;
      for (const pkg of requiredPackages) {
        const pkgPath = path.join(nodeModulesPath, pkg);
        if (!existsSync(pkgPath)) {
          console.log(`❌ Immer noch fehlend: ${pkg}`);
          allInstalled = false;
        }
      }

      if (allInstalled) {
        console.log('🎉 Alle Pakete erfolgreich installiert!\n');
      } else {
        console.log('⚠️  Einige Pakete konnten nicht installiert werden.');
        console.log('Bitte fuehre manuell aus: npm install\n');
      }

    } catch (error) {
      console.error('\n❌ Fehler bei der Installation:');
      console.error(error.message);
      console.error('\nManuelle Installation erforderlich:');
      console.error('1. Oeffne Terminal im Projektverzeichnis');
      console.error('2. Fuehre aus: npm install');
      console.error('3. Starte Server erneut\n');
      process.exit(1);
    }
  } else {
    console.log('✅ Alle Dependencies vorhanden!\n');
  }

  console.log('='.repeat(60));
  console.log('🚀 Starte Roblox Studio API Server...\n');
}

// Fuehre Dependency-Check aus
checkAndInstallDependencies();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
const port = 3000;

app.use(bodyParser.json({ limit: '500mb' }));
app.use(express.text({ limit: '500mb', type: 'text/plain' })); // Support text/plain for /result
app.use(express.static(path.join(__dirname, 'public')));

// ========== Request Queue System ========== 
const requestQueue = [];
const requests = new Map(); // id -> { status, result, timestamp, tool, args }
let isProcessing = false;

// Request Status: 'queued', 'processing', 'completed', 'error', 'timeout'

// ========== MEMORY MANAGEMENT ========== 
const MEMORY_CONFIG = {
  CLEANUP_INTERVAL: 30000,      // 30 Sekunden
  REQUEST_TIMEOUT: 300000,      // 5 Minuten
  APPROVAL_TIMEOUT: 90000,      // 1.5 Minuten (nur wirklich alte!)
  ROBLOX_RESULT_TIMEOUT: 120000 // 2 Minuten
};

// Automatische Memory-Bereinigung
setInterval(() => {
  const now = Date.now();
  let cleanedRequests = 0;
  let cleanedApprovals = 0;
  let cleanedResults = 0;

  // Alte Requests aufräumen (>5 min)
  for (const [id, req] of requests.entries()) {
    if (now - req.timestamp > MEMORY_CONFIG.REQUEST_TIMEOUT) {
      requests.delete(id);
      cleanedRequests++;
    }
  }

  // Timeout approvals aufräumen (>1 min)
  for (const [id, approval] of pendingApprovals.entries()) {
    if (now - approval.request.timestamp > MEMORY_CONFIG.APPROVAL_TIMEOUT) {
      // Ablehnen und aufräumen mit Debugging
      console.log(`[🧹 APPROVAL TIMEOUT] Tool: ${approval.request.tool}, ID: ${id}`);
      approval.resolve('timeout');
      pendingApprovals.delete(id);
      cleanedApprovals++;
    }
  }

  // Alte Roblox Results aufräumen (>2 min) - einfache Implementierung
  for (const [id, result] of robloxResults.entries()) {
    // Wir nehmen an, dass Results älter als 2 Minuten aufgeräumt werden können
    // da der Check-Interval alle 10ms läuft, sollten alte Ergebnisse bereinigt werden
    robloxResults.delete(id);
    cleanedResults++;
  }

  // Memory-Status loggen (nur wenn etwas aufgeräumt wurde)
  if (cleanedRequests > 0 || cleanedApprovals > 0 || cleanedResults > 0) {
    console.log(`[🧹 MEMORY CLEANUP] Requests: ${cleanedRequests}, Approvals: ${cleanedApprovals}, Results: ${cleanedResults}`);
    console.log(`[📊 MEMORY STATUS] Active Requests: ${requests.size}, Pending Approvals: ${pendingApprovals.size}, Roblox Results: ${robloxResults.size}`);
  }

  // Optional: Memory pressure warning
  const totalObjects = requests.size + pendingApprovals.size + robloxResults.size + pendingLongPollRequests.length;
  if (totalObjects > 1000) {
    console.warn(`[⚠️  MEMORY WARNING] Hohe Objekt-Anzahl: ${totalObjects} (Requests: ${requests.size}, Approvals: ${pendingApprovals.size}, Results: ${robloxResults.size}, LongPoll: ${pendingLongPollRequests.length})`);
  }

}, MEMORY_CONFIG.CLEANUP_INTERVAL);

// ========== Roblox Communication ========== 
let robloxCommandQueue = [];
let robloxResults = new Map(); // robloxId -> output
let pendingLongPollRequests = []; // Array of pending response objects for long polling
let lastPluginPoll = 0; // Timestamp of last plugin poll

// ========== Last Tool Call Tracking ========== 
let lastToolCall = null;

function trackLastToolCall(toolName, params, content = null) {
  let cleanedContent = content;

  // For readLine, remove "Line X: " prefix for validation
  if (toolName === 'readLine' && content) {
    cleanedContent = parseReadLineOutput(content);
  }

  lastToolCall = {
    tool: toolName,
    params: params,
    content: cleanedContent, // Store cleaned content for validation
    timestamp: Date.now()
  };
}

// ========== BASE64 ENCODING/DECODING FOR SCRIPT CODE ========== 
// Plugin sendet rohe Strings (keine Kodierung)
// Nur MCP-Requests werden Base64-dekodiert (source, old_string, new_string, lines)

function base64Decode(str) {
  if (!str || typeof str !== 'string') return str;

  // Skip decoding for log messages and system responses
  if (str.startsWith('[SUCCESS]') || str.startsWith('[ERROR]') || str.startsWith('[WARNING]') ||
      str.startsWith('[DEBUG]') || str.startsWith('✅') || str.startsWith('⚠️') ||
      str.includes('[INFO]')) {
    return str;
  }

  // Verbesserte Base64-Validierung und Dekodierung
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(str) || str.length < 4) {
    return str; // Not Base64, return as-is
  }

  try {
    const decoded = Buffer.from(str, 'base64').toString('utf-8');

    // Zusätzliche Validierung: Prüfen ob das dekodierte Ergebnis sinnvoll ist
    if (!decoded || decoded.length === 0) {
      console.warn('[Base64] Decode resulted in empty string, returning original');
      return str;
    }

    return decoded;
  } catch (error) {
    console.error('[Base64] Decode error:', error.message);
    return str; // Fallback: return original string if decode fails
  }
}

// Parse ReadLine output to remove "Line X: " prefix for validation
function parseReadLineOutput(output) {
  if (typeof output !== 'string') return output;

  // Remove "Line X: " prefix from each line for validation
  const lines = output.split('\n');
  const cleanedLines = lines.map(line => {
    // Match pattern: "Line 123: content" or "Line 123: [EMPTY]"
    const match = line.match(/^Line \d+: (.*)$/);
    return match ? match[1] : line;
  });

  return cleanedLines.join('\n');
}

// ========== EditScript Helper Functions ========== 

function searchInReadContent(content, old_string, startLine, endLine) {
  // Work with original content without any normalization
  const lines = content.split('\n');
  const results = [];

  // Create a string with the requested line range
  const rangeText = lines.slice(startLine - 1, endLine).join('\n');

  // Search for all occurrences in the range
  let searchIndex = 0;
  let foundIndex;
  while ((foundIndex = rangeText.indexOf(old_string, searchIndex)) !== -1) {
    // Calculate the actual line number for this occurrence
    const textBeforeMatch = rangeText.substring(0, foundIndex);
    const lineNumber = startLine + textBeforeMatch.split('\n').length - 1;

    results.push({
      lineNumber: lineNumber,
      index: foundIndex,
      type: 'exact',
      matchText: old_string
    });

    searchIndex = foundIndex + 1;
  }

  return results;
}

// Robust string comparison with detailed analysis
// analyzeStringMatch() entfernt - Logik jetzt im Plugin (editScriptGenerator.lua)

function countStringOccurrences(content, old_string, startLine, endLine) {
  // Einfache Suche - volle Logik jetzt im Plugin
  const lines = content.split('\n');
  const rangeText = lines.slice(startLine - 1, endLine).join('\n');

  const occurrences = [];
  let searchIndex = 0;
  let foundIndex;

  while ((foundIndex = rangeText.indexOf(old_string, searchIndex)) !== -1) {
    occurrences.push(foundIndex);
    searchIndex = foundIndex + 1;
  }

  console.log('[DEBUG] Simple string occurrences found:', occurrences.length);
  return occurrences.length;
}

// Helper function to create visual comparison for error messages
function createVisualComparison(searchText, actualText, maxLength = 50) {
  const truncate = (text) => {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  };

  const showEscapes = (text) => {
    return text
      .replace(/\t/g, '\\t')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  };

  return {
    search: {
      original: truncate(searchText),
      escaped: showEscapes(truncate(searchText)),
      length: searchText.length
    },
    actual: {
      original: truncate(actualText),
      escaped: showEscapes(truncate(actualText)),
      length: actualText.length
    }
  };
}

function performScriptEdit(path, old_string, new_string, replace_all = false) {
  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();

    const args = {
      path: path,
      old_string: old_string,
      new_string: new_string,
      replace_all: replace_all
    };

    logRequest(requestId, 'editScript', args);

    // CRITICAL FIX: Execute the edit via editScript tool (not modifyObject!)
    executeLuaInRoblox('editScript', args).then(result => {
      logResult(requestId, true, result);
      resolve(result);
    }).catch(error => {
      logResult(requestId, false, error.message);
      reject(error);
    });
  });
}

// ========== Settings Persistence ========== 
function loadSettings() {
  try {
    if (existsSync(settingsPath)) {
      const data = readFileSync(settingsPath, 'utf8');
      const settings = JSON.parse(data);
      return {
        autoAccept: settings.autoAccept !== undefined ? settings.autoAccept : true,
        strictEditScript: settings.strictEditScript !== undefined ? settings.strictEditScript : false,
        whitelist: settings.whitelist || ['tree', 'get', 'copy', 'readLine', 'getScriptInfo', 'scriptSearch', 'scriptSearchOnly', 'editScript', 'convertScript']
      };
    }
  } catch (error) {
    console.error('⚠️  Fehler beim Laden der Settings:', error.message);
  }

  // Default settings
  return {
    autoAccept: true,
    strictEditScript: false, // Default: Ausgeschaltet (User Wunsch)
    whitelist: ['tree', 'get', 'copy', 'readLine', 'getScriptInfo', 'scriptSearch', 'scriptSearchOnly', 'editScript', 'convertScript']
  };
}

function saveSettings() {
  try {
    const settings = {
      autoAccept: autoAccept,
      strictEditScript: strictEditScript,
      whitelist: Array.from(toolWhitelist)
    };
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
    // Silent save - nur Fehler loggen
  } catch (error) {
    console.error('⚠️  Fehler beim Speichern der Settings:', error.message);
  }
}

// Load settings on startup
const savedSettings = loadSettings();

// ========== Approval System ========== 
let autoAccept = savedSettings.autoAccept;
let strictEditScript = savedSettings.strictEditScript;
let pendingApprovals = new Map(); // requestId -> { resolve, reject, request }
let toolWhitelist = new Set(savedSettings.whitelist);

// ========== Console Logging Helpers ========== 
function logInfo(message) {
  const logMessage = `[${new Date().toLocaleTimeString('de-DE')}] ℹ️  ${message}`;
  console.log(logMessage);
  io.emit('log', { type: 'info', message: logMessage });
}

function logSuccess(message) {
  const logMessage = `[${new Date().toLocaleTimeString('de-DE')}] ✅ ${message}`;
  console.log(logMessage);
  io.emit('log', { type: 'success', message: logMessage });
}

function logError(message) {
  const logMessage = `[${new Date().toLocaleTimeString('de-DE')}] ❌ ${message}`;
  console.log(logMessage);
  io.emit('log', { type: 'error', message: logMessage });
}

function logRequest(id, tool, args) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${new Date().toLocaleTimeString('de-DE')}] 📥 NEUE ANFRAGE`);
  console.log(`  ID: ${id}`);
  console.log(`  Tool: ${tool}`);
  console.log(`  Args: ${JSON.stringify(args, null, 2)}`);
  console.log(`${'='.repeat(60)}\n`);
}

function logResult(id, success, output) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${new Date().toLocaleTimeString('de-DE')}] 📤 ERGEBNIS`);
  console.log(`  ID: ${id}`);
  console.log(`  Status: ${success ? '✅ Erfolg' : '❌ Fehler'}`);
  console.log(`  Output:`);
  console.log(`  ${'-'.repeat(56)}`);
  output.split('\n').forEach(line => console.log(`  ${line}`));
  console.log(`  ${'-'.repeat(56)}`);
  console.log(`${'='.repeat(60)}\n`);
}

// ========== Execute in Roblox (returns JSON instead of Lua) ========== 
function executeLuaInRoblox(tool, args, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const robloxId = crypto.randomUUID();

    // Push JSON command (NOT Lua code!)
    const command = {
      id: robloxId,
      tool: tool,      // ← Tool name
      args: args       // ← JSON arguments
    };
    robloxCommandQueue.push(command);

    // 🚀 LONG POLLING: Notify waiting requests INSTANTLY!
    if (pendingLongPollRequests.length > 0) {
      const pending = pendingLongPollRequests.shift(); // Get first waiting request
      clearTimeout(pending.timeoutId); // Cancel timeout
      logInfo(`🚀 Long Poll INSTANT Antwort gesendet (ID: ${command.id}, Tool: ${command.tool})`);
      
      try {
          pending.res.json({
            tool: command.tool,
            args: command.args,
            id: command.id
          });
          robloxCommandQueue.shift(); // Remove from queue ONLY after successful send check
      } catch (err) {
          logError(`Fehler beim Senden an Long Poll Client: ${err.message}. Command bleibt in Queue.`);
          // Command bleibt in robloxCommandQueue (wurde noch nicht geshiftet)
          // Wir versuchen es beim nächsten Poll erneut
      }
    }

    const startTime = Date.now();
    let logCounter = 0;
    
    console.log(`[DEBUG-SERVER] Warte auf Resultat für ID: ${robloxId} (Timeout: ${timeoutMs}ms)`);
    
    const checkInterval = setInterval(() => {
      logCounter++;
      
      if (robloxResults.has(robloxId)) {
        console.log(`[DEBUG-SERVER] Resultat GEFUNDEN für ID: ${robloxId} (nach ${Date.now() - startTime}ms)`);
        clearInterval(checkInterval);
        let result = robloxResults.get(robloxId);
        robloxResults.delete(robloxId);

        // Convert [ERROR] messages to exceptions for proper MCP error handling
        if (typeof result === 'string' && result.includes('[ERROR]')) {
          // Extract clean error message without [ERROR] prefix
          const errorMessage = result.replace(/^\ \[ERROR\]\s*/, '').trim();
          reject(new Error(errorMessage));
          return;
        }

        resolve(result);
      } else if (Date.now() - startTime > timeoutMs) {
        console.log(`[DEBUG-SERVER] TIMEOUT für ID: ${robloxId} (nach ${Date.now() - startTime}ms)`);
        clearInterval(checkInterval);
        reject(new Error('Timeout: Keine Antwort von Roblox Studio'));
      } else {
          // Logge Status alle 2 Sekunden (bei 10ms Interval = 200 Ticks)
          if (logCounter % 200 === 0) {
              console.log(`[DEBUG-SERVER] Warte noch immer auf ID: ${robloxId} (${Date.now() - startTime}ms vergangen)...`);
          }
      }
    }, 10); // 10ms statt 100ms - Optimiert für Multi-Tool Performance!
  });
}

// ========== Approval System ========== 
async function requestApproval(requestId, tool, args) {
  // Auto-Accept ODER Tool ist in Whitelist
  if (autoAccept || toolWhitelist.has(tool)) {
    if (toolWhitelist.has(tool) && !autoAccept) {
      logInfo(`✅ Tool automatisch erlaubt (Whitelist): ${tool}`);
    }
    return true; // Auto-approved
  }

  return new Promise((resolve) => {
    const approvalRequest = {
      id: requestId,
      tool,
      args,
      timestamp: Date.now()
    };

    pendingApprovals.set(requestId, { resolve, request: approvalRequest });
    io.emit('approvalRequest', approvalRequest);
    logInfo(`⏳ Warte auf Benutzer-Genehmigung: ${requestId} (${tool})`);
  });
}

// ========== Queue Processor ========== 
async function processQueue() {
  if (isProcessing || requestQueue.length === 0) {
    return;
  }

  isProcessing = true;
  const requestId = requestQueue.shift();
  const request = requests.get(requestId);

  if (!request) {
    isProcessing = false;
    processQueue();
    return;
  }

  request.status = 'processing';
  logInfo(`Verarbeite Anfrage: ${requestId} (${request.tool})`);

  // Request approval if auto-accept is off
  const approved = await requestApproval(requestId, request.tool, request.args);

  if (!approved) {
    request.status = 'error';
    request.result = '❌ Tool Call wurde vom Benutzer abgelehnt';
    logError(`Anfrage abgelehnt: ${requestId} (${request.tool})`);
    isProcessing = false;
    setTimeout(() => processQueue(), 100);
    return;
  }

  try {
    // Execute in Roblox (sends JSON instead of Lua)
    const result = await executeLuaInRoblox(request.tool, request.args);

    // Store result
    request.status = 'completed';
    request.result = result;
    logResult(requestId, true, result);

    // Track the tool call for editScript validation
    trackLastToolCall(request.tool, request.args, result);
  } catch (error) {
    request.status = 'error';
    request.result = error.message;
    logResult(requestId, false, error.message);
  }

  isProcessing = false;

  // Process next in queue
  setTimeout(() => processQueue(), 100);
}

// ========== REST API Endpoints ========== 

// Helper: Create error response with requestId
function createErrorResponse(tool, args, errorMessage) {
  const requestId = crypto.randomUUID();
  requests.set(requestId, {
    status: 'error',
    tool,
    args,
    result: errorMessage,
    timestamp: Date.now()
  });
  return {
    id: requestId,
    status: 'error',
    message: errorMessage
  };
}

// POST /api/tree - Execute tree tool (legacy queue-based)
app.post('/api/tree', async (req, res) => {
  const { path } = req.body;

  // Validierung: Wenn Parameter fehlt, direkt als Error speichern
  if (!path) {
    return res.json(createErrorResponse('tree', { path }, 'Parameter "path" fehlt'));
  }

  const requestId = crypto.randomUUID();

  requests.set(requestId, {
    status: 'queued',
    tool: 'tree',
    args: { path },
    result: null,
    timestamp: Date.now()
  });

  requestQueue.push(requestId);
  logRequest(requestId, 'tree', { path });

  processQueue();

  res.json({
    id: requestId,
    status: 'queued',
    message: 'Anfrage in Warteschlange'
  });
});

// GET /api/status/:id - Get request status
app.get('/api/status/:id', (req, res) => {
  const { id } = req.params;
  const request = requests.get(id);

  if (!request) {
    return res.status(404).json({ error: 'Anfrage nicht gefunden' });
  }

  res.json({
    id,
    status: request.status,
    tool: request.tool,
    args: request.args,
    hasResult: request.result !== null
  });
});

// GET /api/result/:id - Get request result
app.get('/api/result/:id', (req, res) => {
  const { id } = req.params;
  const request = requests.get(id);

  if (!request) {
    return res.status(404).json({ error: 'Anfrage nicht gefunden' });
  }

  if (request.status === 'queued' || request.status === 'processing') {
    return res.json({
      id,
      status: request.status,
      message: 'Anfrage wird noch verarbeitet'
    });
  }

  res.json({
    id,
    status: request.status,
    result: request.result,
    tool: request.tool,
    args: request.args
  });
});

// GET /api/queue - Get queue status
app.get('/api/queue', (req, res) => {
  res.json({
    queueLength: requestQueue.length,
    totalRequests: requests.size,
    isProcessing,
    requests: Array.from(requests.entries()).map(([id, req]) => ({
      id,
      status: req.status,
      tool: req.tool,
      timestamp: req.timestamp
    }))
  });
});

// ========== Roblox Plugin Endpoints ========== 

// GET /ping - Health check
app.get('/ping', (req, res) => {
  res.json({ pong: true });
});

// GET /command - Long Polling: Waits for commands (max 30s timeout)
app.get('/command', (req, res) => {
  // Plugin ist verbunden - notify GUI
  lastPluginPoll = Date.now();
  io.emit('robloxPluginStatus', true);

  if (robloxCommandQueue.length > 0) {
    // Command sofort verfügbar - INSTANT senden!
    const next = robloxCommandQueue.shift();
    logInfo(`➡️  JSON-Command an Roblox gesendet (ID: ${next.id}, Tool: ${next.tool})`);
    res.json({
      tool: next.tool,
      args: next.args,
      id: next.id
    });
  } else {
    // Kein Command verfügbar - Request "parken" für Long Polling
    logInfo(`🔄 Long Poll Request geparkt (${pendingLongPollRequests.length + 1} wartend)`);

    // Timeout nach 15 Sekunden (sicherer als Client Timeout)
    const timeoutId = setTimeout(() => {
      // Entferne aus pending list mit Sicherheit
      const index = pendingLongPollRequests.findIndex(item => item.res === res);
      if (index !== -1) {
        const removed = pendingLongPollRequests.splice(index, 1)[0];
        logInfo(`⏱️  Long Poll Timeout - bereinige Request (${pendingLongPollRequests.length} verbleibend)`);

        try {
          res.json({ tool: null }); // Empty response nach Timeout
        } catch (error) {
          // Response wurde bereits geschlossen oder ist ungültig
          logError(`Long Poll Response Fehler: ${error.message}`);
        }
      } else {
        logInfo(`⏱️  Long Poll Timeout - Request bereits bereinigt`);
      }
    }, 15000); // 15 Sekunden

    // Request parken
    pendingLongPollRequests.push({ res, timeoutId });
  }
});

// POST /result - Roblox sends results (vereinfacht für direkte Strings)
app.post('/result', (req, res) => {
  // Empfange direkten String: "ID\nOutput"
  let body = req.body;
  const contentType = req.headers['content-type'];
  console.log(`[DEBUG-SERVER] /result empfangen. Type: ${typeof body}, Length: ${body ? body.length : 0}, Content-Type: ${contentType}`);

  if (typeof body === 'string') {
    // Teile in ID und Output auf
    const firstNewlineIndex = body.indexOf('\n');

    if (firstNewlineIndex !== -1) {
      const id = body.substring(0, firstNewlineIndex);
      const output = body.substring(firstNewlineIndex + 1);
      
      console.log(`[DEBUG-SERVER] ID extrahiert: ${id} (Length: ${id.length})`);
      if (robloxResults.has(id)) {
          console.log(`[DEBUG-SERVER] ACHTUNG: ID ${id} überschreibt existierendes Resultat!`);
      } else {
          console.log(`[DEBUG-SERVER] Speichere Resultat für ID ${id} in Map.`);
      }

      robloxResults.set(id, output);
      logInfo(`⬅️  Ausgabe von Roblox empfangen (ID: ${id}, vereinfachter String-Modus)`);
    } else {
      console.log(`[DEBUG-SERVER] ❌ Kein Newline gefunden. Body: ${body.substring(0, 100)}...`);
      
      if (typeof body === 'object') {
           const { output, id } = body;
           if (id !== undefined) {
             robloxResults.set(id, output);
             logInfo(`⬅️  Ausgabe von Roblox empfangen (ID: ${id}, JSON-Modus via BodyParser)`);
           }
      } else {
          logError(`Ungültiges Format empfangen: ${body.substring(0, 50)}...`);
      }
    }
  } else if (typeof body === 'object') {
    // Fallback für alte JSON-Format (Kompatibilität)
    console.log(`[DEBUG-SERVER] Body ist Object: ${JSON.stringify(body).substring(0, 100)}...`);
    const { output, id } = body;
    if (id !== undefined) {
      robloxResults.set(id, output);
      logInfo(`⬅️  Ausgabe von Roblox empfangen (ID: ${id}, JSON-Modus)`);
    } else {
      logError('Ausgabe ohne ID empfangen (JSON)');
    }
  } else {
      console.log(`[DEBUG-SERVER] ❌ Unerwarteter Body-Typ: ${typeof body}`);
  }

  res.json({ received: true });
});

// GET /gui - Main GUI
app.get('/gui', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'gui.html'));
});

// ========== Generic Direct Tool Handler ========== 
// This handles all tools that don't have specific direct endpoints yet
app.post('/api/:tool/direct', async (req, res) => {
  const { tool } = req.params;
  const args = req.body;

  // Skip if this is not a valid tool
  const validTools = [
    'tree', 'create', 'get', 'modifyObject', 'delete', 'copy', 'readLine', 'deleteLines',
    'insertLines', 'getScriptInfo', 'scriptSearch',
    'scriptSearchOnly', 'editScript', 'convertScript'
  ];

  if (!validTools.includes(tool)) {
    return res.json({
      success: false,
      error: `Unknown tool: ${tool}`
    });
  }

  // Decode Base64-encoded parameters for script code tools
  if (tool === 'create') {
    if (args.luaCode) args.luaCode = base64Decode(args.luaCode);
    if (args.source) args.source = base64Decode(args.source);
  }
  if (tool === 'modifyObject') {
    if (args.luaCode) args.luaCode = base64Decode(args.luaCode);
    if (args.source) args.source = base64Decode(args.source);
  }
  if (tool === 'editScript') {
    if (args.old_string) args.old_string = base64Decode(args.old_string);
    if (args.new_string) args.new_string = base64Decode(args.new_string);
  }
  // Decode Base64-encoded lines for insertLines
  if (tool === 'insertLines' && args.lines && Array.isArray(args.lines)) {
    args.lines = args.lines.map(line => base64Decode(line));
  }

  // requestId für gesamten Handler definieren (BEVOR if-Block!)
  const requestId = crypto.randomUUID();
  logRequest(requestId, tool, args);

  // Check if tool is in whitelist (if autoAccept is false)
  if (!autoAccept && !toolWhitelist.has(tool)) {
    // Request approval from UI
    const approved = await requestApproval(requestId, tool, args);
    if (!approved) {
      logError(`Anfrage abgelehnt: ${requestId} (${tool})`);
      return res.json({
        success: false,
        error: `Tool "${tool}" wurde vom Benutzer abgelehnt.`
      });
    } else if (approved === 'timeout') {
      logError(`Anfrage Timeout: ${requestId} (${tool})`);
      return res.json({
        success: false,
        error: `Tool "${tool}" Timeout - keine Antwort vom Benutzer.`
      });
    }
    logInfo(`✅ Tool genehmigt: ${requestId} (${tool})`);
  }

  try {
    // For tools that need special validation, add it here
    if (tool === 'delete' && (!args.path || args.path.trim() === '')) {
      return res.json({
        success: false,
        error: 'Parameter "path" wird benötigt und darf nicht leer sein'
      });
    }

    if (tool === 'scriptSearch' && (!args.searchText || args.searchText.trim() === '')) {
      return res.json({
        success: false,
        error: 'Parameter "searchText" wird benötigt und darf nicht leer sein'
      });
    }

    // editScript workflow validation - nur readLine-Check (Parameter-Validierung wird von MCP-Server gemacht)
    if (tool === 'editScript') {
      const { path } = args;

      // Nur workflow-spezifische Validierung: Prüfe ob vorher readLine aufgerufen wurde (gleicher Pfad)
      if (strictEditScript) {
        if (!lastToolCall || lastToolCall.tool !== 'readLine' || lastToolCall.params.path !== path) {
          return res.json({
            success: false,
            error: 'Vor dem Aufrufen von editScript muss zuerst eine readLine-Anfrage ausgeführt werden.'
          });
        }
      }
    }

    // Execute directly in Roblox and wait for result
    const result = await executeLuaInRoblox(tool, args);

    // Track the tool call for editScript validation
    trackLastToolCall(tool, args, result);

    logResult(requestId, true, result);
    res.json({
      success: true,
      output: result
    });
  } catch (error) {
    // Detailliertes Error Handling mit besseren Fehlermeldungen
    let errorMessage = error.message;

    if (error.message.includes('Timeout')) {
      errorMessage = 'Roblox Studio antwortet nicht - Timeout';
    } else if (error.message.includes('ECONNREFUSED')) {
      errorMessage = 'Roblox Studio Plugin nicht verbunden';
    } else if (error.message.includes('fetch')) {
      errorMessage = 'Verbindungsfehler zum Roblox Plugin';
    }

    logResult(requestId, false, errorMessage);
    res.json({
      success: false,
      error: errorMessage
    });
  }
});

// POST /api/shutdown - Shutdown server
app.post('/api/shutdown', (req, res) => {
  logInfo('🛑 Shutdown Signal empfangen - Server wird beendet...');
  res.json({ message: 'Server wird heruntergefahren' });

  setTimeout(() => {
    process.exit(0);
  }, 500);
});

// ========== Socket.io Events ========== 
io.on('connection', (socket) => {
  logInfo(`🔌 GUI verbunden (Socket ID: ${socket.id})`);

  // Send initial settings on connect
  socket.emit('whitelistUpdate', Array.from(toolWhitelist));
  socket.emit('autoAcceptUpdate', autoAccept);
  socket.emit('strictEditScriptUpdate', strictEditScript);

  // Toggle Auto-Accept
  socket.on('toggleAutoAccept', (value) => {
    autoAccept = value;
    logInfo(`🔄 Auto-Accept ${value ? 'aktiviert' : 'deaktiviert'}`);
    saveSettings(); // 💾 Speichere Einstellungen
  });

  // Toggle Strict EditScript
  socket.on('toggleStrictEditScript', (value) => {
    strictEditScript = value;
    logInfo(`🛡️ Strict EditScript Mode ${value ? 'aktiviert' : 'deaktiviert'}`);
    saveSettings(); // 💾 Speichere Einstellungen
  });

  // Get Whitelist
  socket.on('getWhitelist', () => {
    socket.emit('whitelistUpdate', Array.from(toolWhitelist));
  });

  // Toggle Tool in Whitelist
  socket.on('toggleWhitelist', (tool) => {
    if (toolWhitelist.has(tool)) {
      toolWhitelist.delete(tool);
      logInfo(`🔧 Tool von Whitelist entfernt: ${tool}`);
    } else {
      toolWhitelist.add(tool);
      logInfo(`🔧 Tool zur Whitelist hinzugefügt: ${tool}`);
    }
    io.emit('whitelistUpdate', Array.from(toolWhitelist));
    saveSettings(); // 💾 Speichere Einstellungen
  });

  // Approval Response
  socket.on('approvalResponse', (data) => {
    const { id, approved } = data;
    const pending = pendingApprovals.get(id);

    if (pending) {
      pending.resolve(approved);
      pendingApprovals.delete(id);
      io.emit('approvalProcessed', { id });

      if (approved) {
        logSuccess(`✅ Anfrage genehmigt: ${id}`);
      } else {
        logError(`❌ Anfrage abgelehnt: ${id}`);
      }
    }
  });

  socket.on('disconnect', () => {
    logInfo(`🔌 GUI getrennt (Socket ID: ${socket.id})`);
  });
});

// ========== Plugin Status Monitor ========== 
setInterval(() => {
  const timeSinceLastPoll = Date.now() - lastPluginPoll;
  const isOffline = timeSinceLastPoll > 35000; // 35s (Plugin pollt alle 30s)

  if (isOffline && lastPluginPoll > 0) {
    io.emit('robloxPluginStatus', false);
  }
}, 5000); // Check every 5 seconds

// ========== Start Server ========== 
httpServer.listen(port, () => {
  console.log('\n' + '='.repeat(60));
  console.log('🚀 ROBLOX STUDIO JSON API SERVER (PREMIUM READY)');
  console.log('='.repeat(60));
  console.log(`Server läuft auf: http://localhost:${port}`);
  console.log(`\n⚠️  WICHTIG: Dieser Server sendet JSON (NICHT Lua-Code)`);
  console.log(`⚠️  Lua-Generierung erfolgt im Premium Plugin!`);
  console.log(`\nVerfügbare Endpoints:`);
  console.log(`  === Legacy Queue-Based (für Kompatibilität):`);
  console.log(`  POST /api/tree          - Tree Tool ausführen (Queue)`);
  console.log(`  POST /api/create        - Create Tool ausführen (Queue)`);
  console.log(`  POST /api/get           - Get Tool ausführen (Queue)`);
  console.log(`  POST /api/modifyObject   - ModifyObject Tool ausführen (Queue)`);
  console.log(`  POST /api/readLine      - readLine Tool ausführen (Queue)`);
  console.log(`  === 🚀 NEW: Direct Processing (KEIN Polling!):`);
  console.log(`  POST /api/:tool/direct  - Generic Direct Tool Handler (Handles all tools)`);
  console.log(`  === Legacy Status Endpoints:`);
  console.log(`  GET  /api/status/:id    - Request Status abrufen`);
  console.log(`  GET  /api/result/:id    - Ergebnis abrufen`);
  console.log(`  GET  /api/queue         - Warteschlange anzeigen`);
  console.log(`\n✅ Multi-Tool Calls verwenden jetzt Direct Processing!`);
  console.log(`✅ Kein Polling mehr nötig - sofortige Antworten!`);
  console.log(`\nRoblox Plugin Endpoints:`);
  console.log(`  GET  /ping              - Health Check`);
  console.log(`  GET  /command           - Befehle abrufen (JSON)`);
  console.log(`  POST /result            - Ergebnisse senden`);
  console.log('='.repeat(60));
  console.log(`\n💾 Settings geladen:`);
  console.log(`   Auto-Accept: ${autoAccept ? '✅ AN' : '❌ AUS'}`);
  console.log(`   Whitelist: ${Array.from(toolWhitelist).length} Tools`);
  console.log('='.repeat(60) + '\n');
  logSuccess('JSON-Server bereit - Warte auf Anfragen...\n');
});
