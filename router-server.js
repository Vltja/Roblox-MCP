#!/usr/bin/env node
/**
 * ROUTER SERVER - Message Broker for Multi-Agent MCP
 * 
 * Architecture:
 *   - Plugin Server (Port 3001): For Roblox Plugin connections
 *   - MCP Server (Port 4000): For MCP instances
 *   - Routes messages by Agent-ID
 *   - Buffers responses for each agent
 */

import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// ========== LOGGING SYSTEM ==========
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, `router-server-${new Date().toISOString().slice(0, 10)}.log`);

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

// ========== CONFIGURATION ==========
const CONFIG = {
  PLUGIN_PORT: parseInt(process.env.MCP_PLUGIN_PORT) || 3001,
  MCP_PORT: parseInt(process.env.MCP_ROUTER_PORT) || 4000,
  TIMEOUT: 120000,
  MAX_BUFFER_SIZE: 100  // Max buffered messages per agent
};

log('========================================');
log('[ROUTER] Roblox Studio Router Server startet...');
log(`[ROUTER] Plugin Port: ${CONFIG.PLUGIN_PORT}`);
log(`[ROUTER] MCP Port: ${CONFIG.MCP_PORT}`);
log(`[ROUTER] Timeout: ${CONFIG.TIMEOUT}ms`);
log('========================================');

// ========== DATA STRUCTURES ==========
// Connected Plugins: context -> ws
const connectedPlugins = new Map();

// Connected MCPs: agentId -> { ws, registered: boolean }
const connectedMCPs = new Map();

// Message Buffer: agentId -> [{id, result/error, timestamp}]
const messageBuffer = new Map();

// Pending Requests: requestId -> {agentId, resolve, reject, timeout, timestamp}
const pendingRequests = new Map();

// ========== PLUGIN WEBSOCKET SERVER (Port 3001) ==========
const pluginHttpServer = createServer();
const pluginWss = new WebSocketServer({ server: pluginHttpServer });

pluginWss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  log(`[PLUGIN] Neue Verbindung von: ${clientIp}`);
  
  let pluginContext = null;
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      log(`[PLUGIN] Nachricht empfangen: ${message.type}`);
      
      // Plugin registriert sich mit Context
      if (message.type === 'register' && message.context) {
        pluginContext = message.context;
        connectedPlugins.set(pluginContext, ws);
        log(`[PLUGIN] Client registriert als: ${pluginContext}`);
        log(`[PLUGIN] Aktive Plugins: ${Array.from(connectedPlugins.keys()).join(', ')}`);
        
        ws.send(JSON.stringify({ type: 'registered', context: pluginContext }));
        return;
      }
      
      // Result von Plugin für einen Agent
      if (message.type === 'result' && message.agentId && message.id) {
        log(`[PLUGIN] Result für Agent ${message.agentId}, Request ${message.id}`);
        
        // 1. Puffere das Result für diesen Agent
        bufferMessage(message);
        
        // 2. Sende an entsprechenden MCP wenn verbunden
        const mcpClient = connectedMCPs.get(message.agentId);
        if (mcpClient && mcpClient.ws && mcpClient.ws.readyState === 1) {
          const resultMsg = {
            type: 'result',
            id: message.id,
            result: message.result,
            error: message.error,
            encoded: message.encoded  // Base64-Flag durchreichen
          };
          mcpClient.ws.send(JSON.stringify(resultMsg));
          log(`[ROUTER] Result weitergeleitet an MCP ${message.agentId}`);
        } else {
          log(`[ROUTER] MCP ${message.agentId} nicht verbunden - Result gepuffert`);
        }
        
        // 3. Löse pending request auf falls vorhanden
        const pending = pendingRequests.get(message.id);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingRequests.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error));
          } else {
            pending.resolve(message.result);
          }
          log(`[ROUTER] Pending request ${message.id} aufgelöst`);
        }
        return;
      }
      
      // Pong für Keepalive
      if (message.type === 'pong') {
        log('[PLUGIN] Pong empfangen');
        return;
      }
      
      log(`[PLUGIN] Unbekannte Nachricht: ${message.type}`);
      
    } catch (error) {
      log(`[PLUGIN] Parse-Fehler: ${error.message}`);
    }
  });
  
  ws.on('close', () => {
    log(`[PLUGIN] Client getrennt: ${pluginContext || 'unregistriert'}`);
    if (pluginContext) {
      connectedPlugins.delete(pluginContext);
    }
  });
  
  ws.on('error', (error) => {
    log(`[PLUGIN] WebSocket Fehler: ${error.message}`);
  });
  
  // Initialer Ping
  setTimeout(() => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }, 100);
});

// Start Plugin Server
pluginHttpServer.listen(CONFIG.PLUGIN_PORT, () => {
  log(`[PLUGIN] ✅ Plugin WebSocket Server läuft auf Port ${CONFIG.PLUGIN_PORT}`);
});

// ========== MCP WEBSOCKET SERVER (Port 4000) ==========
const mcpHttpServer = createServer();
const mcpWss = new WebSocketServer({ server: mcpHttpServer });

mcpWss.on('connection', (ws, req) => {
  const clientIp = req.socket.remoteAddress;
  log(`[MCP] Neue Verbindung von: ${clientIp}`);
  
  let agentId = null;
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      log(`[MCP] Nachricht empfangen: ${message.type}`);
      
      // MCP registriert sich mit Agent-ID
      if (message.type === 'register' && message.agentId) {
        agentId = message.agentId;
        connectedMCPs.set(agentId, { ws, registered: true });
        log(`[MCP] Agent registriert: ${agentId}`);
        log(`[MCP] Aktive Agents: ${Array.from(connectedMCPs.keys()).join(', ')}`);
        
        ws.send(JSON.stringify({ type: 'registered', agentId: agentId }));
        
        // Sende gepufferte Nachrichten für diesen Agent
        sendBufferedMessages(agentId, ws);
        return;
      }
      
      // Command von MCP an Plugin(s)
      if (message.type === 'command' && message.agentId && message.id) {
        log(`[MCP] Command von Agent ${message.agentId}: ${message.tool} (${message.id})`);

        // STUDIO STATUS - Router antwortet direkt (nicht an Plugin weiterleiten)
        if (message.tool === 'studio_status') {
          const contexts = Array.from(connectedPlugins.keys());
          const playtestActive = contexts.includes('playtest_server') || contexts.includes('playtest_client');

          const response = {
            playtest: playtestActive,
            contexts: contexts,
            studio: contexts.includes('studio'),
            playtest_server: contexts.includes('playtest_server'),
            playtest_client: contexts.includes('playtest_client')
          };

          ws.send(JSON.stringify({
            type: 'result',
            id: message.id,
            result: JSON.stringify(response, null, 2)
          }));

          log(`[ROUTER] studio_status: playtest=${playtestActive}, contexts=${contexts.join(', ')}`);
          return;
        }

        // Forward an alle verbundenen Plugins
        const forwardMsg = {
          type: 'command',
          agentId: message.agentId,
          id: message.id,
          tool: message.tool,
          params: message.params || {}
        };

        // CONTEXT-BASIERTES ROUTING
        let targetContext = message.params?.context;

        // AUTO-CONTEXT für playtest_control
        // Wenn playtest_control stop ohne context aufgerufen wird → automatisch playtest_server
        if (message.tool === 'playtest_control' && message.params?.action === 'stop' && !targetContext) {
          targetContext = 'playtest_server';
          log(`[ROUTER] Auto-Context: playtest_control stop → context="${targetContext}"`);
        }

        let forwardedCount = 0;

        if (targetContext) {
          // Kontext-spezifisches Routing: Nur an Plugin mit passendem Context
          log(`[ROUTER] Context-Routing: suche Plugin mit context="${targetContext}"`);

          const pluginWs = connectedPlugins.get(targetContext);
          if (pluginWs && pluginWs.readyState === 1) {
            pluginWs.send(JSON.stringify(forwardMsg));
            forwardedCount++;
            log(`[ROUTER] Command an Plugin ${targetContext} weitergeleitet (Context-Routing)`);
          } else {
            log(`[ROUTER] Kein Plugin mit context="${targetContext}" verbunden`);
          }
        } else {
          // Kein Context angegeben: Broadcast an alle Plugins (altes Verhalten)
          for (const [context, pluginWs] of connectedPlugins.entries()) {
            if (pluginWs.readyState === 1) {
              pluginWs.send(JSON.stringify(forwardMsg));
              forwardedCount++;
              log(`[ROUTER] Command an Plugin ${context} weitergeleitet (Broadcast)`);
            }
          }
        }

        if (forwardedCount === 0) {
          let errorMsg;
          if (targetContext) {
            // Kontext-spezifische Fehlermeldung
            if (targetContext === 'playtest_server' || targetContext === 'playtest_client') {
              errorMsg = `[ERROR] Kein Play-Test aktiv. Context "${targetContext}" nicht verbunden.`;
            } else {
              errorMsg = `[ERROR] Kein Plugin mit context="${targetContext}" verbunden.`;
            }
            log(`[ROUTER] Context-Routing fehlgeschlagen: ${targetContext}`);
          } else {
            errorMsg = 'Kein Plugin verbunden. Bitte verbinden Sie das Roblox Plugin zuerst.';
          }

          ws.send(JSON.stringify({
            type: 'result',
            id: message.id,
            error: errorMsg
          }));
        }
        return;
      }
      
      log(`[MCP] Unbekannte Nachricht: ${message.type}`);
      
    } catch (error) {
      log(`[MCP] Parse-Fehler: ${error.message}`);
    }
  });
  
  ws.on('close', () => {
    log(`[MCP] Agent getrennt: ${agentId || 'unregistriert'}`);
    if (agentId) {
      connectedMCPs.delete(agentId);
    }

    // AUTO-SHUTDOWN: Wenn kein MCP mehr verbunden, beende Router
    if (connectedMCPs.size === 0) {
      log('[ROUTER] Keine MCPs mehr verbunden - beende Router');
      setTimeout(() => {
        if (connectedMCPs.size === 0) {
          log('[ROUTER] ✅ Router wird beendet');
          process.exit(0);
        }
      }, 2000);  // 2 Sekunden warten falls ein neuer MCP kommt
    }
  });
  
  ws.on('error', (error) => {
    log(`[MCP] WebSocket Fehler: ${error.message}`);
  });
});

// Start MCP Server
mcpHttpServer.listen(CONFIG.MCP_PORT, () => {
  log(`[MCP] ✅ MCP WebSocket Server läuft auf Port ${CONFIG.MCP_PORT}`);
});

// ========== BUFFER MANAGEMENT ==========
function bufferMessage(message) {
  const agentId = message.agentId;
  
  if (!messageBuffer.has(agentId)) {
    messageBuffer.set(agentId, []);
  }
  
  const buffer = messageBuffer.get(agentId);
  
  // Füge Nachricht hinzu
  buffer.push({
    id: message.id,
    result: message.result,
    error: message.error,
    encoded: message.encoded,  // Base64-Flag durchreichen
    timestamp: Date.now()
  });
  
  // Begrenze Buffer-Größe
  if (buffer.length > CONFIG.MAX_BUFFER_SIZE) {
    buffer.shift(); // Entferne älteste Nachricht
    log(`[BUFFER] Buffer für ${agentId} auf ${CONFIG.MAX_BUFFER_SIZE} begrenzt`);
  }
  
  log(`[BUFFER] Nachricht für ${agentId} gepuffert (Buffer-Size: ${buffer.length})`);
}

function sendBufferedMessages(agentId, ws) {
  const buffer = messageBuffer.get(agentId);
  
  if (!buffer || buffer.length === 0) {
    log(`[BUFFER] Keine gepufferten Nachrichten für ${agentId}`);
    return;
  }
  
  log(`[BUFFER] Sende ${buffer.length} gepufferte Nachrichten an ${agentId}`);
  
  for (const msg of buffer) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({
        type: 'result',
        id: msg.id,
        result: msg.result,
        error: msg.error,
        encoded: msg.encoded  // Base64-Flag durchreichen
      }));
    }
  }
  
  // Leere Buffer nach Versand
  messageBuffer.delete(agentId);
}

// ========== KEEPALIVE ==========
setInterval(() => {
  // Ping alle Plugins
  for (const [context, ws] of connectedPlugins.entries()) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }
  }
  
  // Ping alle MCPs
  for (const [agentId, client] of connectedMCPs.entries()) {
    if (client.ws.readyState === 1) {
      client.ws.send(JSON.stringify({ type: 'ping' }));
    }
  }
}, 30000);

// ========== STATUS ENDPOINT ==========
function getStatus() {
  return {
    plugins: Array.from(connectedPlugins.keys()),
    agents: Array.from(connectedMCPs.keys()),
    bufferedMessages: Array.from(messageBuffer.entries()).map(([id, buf]) => ({
      agentId: id,
      count: buf.length
    })),
    pendingRequests: pendingRequests.size
  };
}

// Log Status alle 60 Sekunden
setInterval(() => {
  const status = getStatus();
  log(`[STATUS] Plugins: ${status.plugins.join(', ') || 'none'}`);
  log(`[STATUS] Agents: ${status.agents.join(', ') || 'none'}`);
  log(`[STATUS] Buffered: ${status.bufferedMessages.reduce((sum, b) => sum + b.count, 0)} messages`);
}, 60000);

// ========== ERROR HANDLING ==========
process.on('uncaughtException', (error) => {
  log('[ROUTER ERROR] Uncaught Exception:', error.message);
  log('[ROUTER ERROR] Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  log('[ROUTER ERROR] Unhandled Rejection:', reason);
});

// ========== GRACEFUL SHUTDOWN ==========
process.on('SIGTERM', () => {
  log('[ROUTER] SIGTERM received - shutting down');
  
  // Schließe alle Verbindungen
  pluginWss.clients.forEach(ws => ws.close());
  mcpWss.clients.forEach(ws => ws.close());
  
  pluginHttpServer.close();
  mcpHttpServer.close();
  
  process.exit(0);
});

log('[ROUTER] ✅ Router Server bereit');
log(`[ROUTER] Plugins verbinden zu: ws://localhost:${CONFIG.PLUGIN_PORT}`);
log(`[ROUTER] MCPs verbinden zu: ws://localhost:${CONFIG.MCP_PORT}`);
