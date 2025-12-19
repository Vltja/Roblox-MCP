import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

// ========== GOOGLE GEMINI OPTIMIZED CONFIGURATION ==========
const GEMINI_CONFIG = {
  TIMEOUT: 120000,             // 120s timeout (2 minutes) - erhöht für große readLine-Anfragen
  MAX_RESPONSE_SIZE: 50 * 1024 * 1024,  // 50MB max response
  // MULTI_TOOL_LIMIT removed - unlimited tools per call
  API_BASE_URL: 'http://localhost:3000'
};

console.error('[MCP GEMINI] Google Gemini optimierter MCP Server startet...');
console.error(`[MCP GEMINI] Timeout: ${GEMINI_CONFIG.TIMEOUT}ms`);
console.error(`[MCP GEMINI] Max Response: ${Math.round(GEMINI_CONFIG.MAX_RESPONSE_SIZE / 1024 / 1024)}MB`);
console.error('[MCP GEMINI] Multi-Tool Limit: REMOVED - Unlimited tools per call!');

// ========== UNIFIED STRING HANDLING SYSTEM ==========
// Zentrale Funktionen für konsistente Kodierung über alle Tools

// Kodiere Strings für MCP → Express Kommunikation
// Verbesserte Base64-Kodierung mit Fehlerbehandlung
function unifiedEncode(str) {
  if (!str || typeof str !== 'string') return str;

  try {
    // Prüfen ob String bereits Base64-kodiert ist (um Doppel-Kodierung zu vermeiden)
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (base64Regex.test(str) && str.length >= 4) {
      // Teste ob es gültiges Base64 ist
      try {
        const decoded = Buffer.from(str, 'base64').toString('utf-8');
        if (decoded && decoded !== str) {
          // War bereits gültiges Base64, zurückgeben wie es war
          return str;
        }
      } catch (e) {
        // War kein gültiges Base64, fahre mit Kodierung fort
      }
    }

    return Buffer.from(str, 'utf-8').toString('base64');
  } catch (error) {
    console.error('[Base64] Encode error:', error.message);
    return str; // Fallback: return original if encode fails
  }
}

// Dekodiere Strings von Express → MCP Kommunikation
// Empfängt originalen Inhalt ohne Escape-Sequenz-Probleme
function unifiedDecode(str) {
  if (!str || typeof str !== 'string') return str;

  // System-Nachrichten nicht dekodieren (kein Base64)
  if (str.startsWith('✅') || str.startsWith('[SUCCESS]') ||
      str.startsWith('[ERROR]') || str.startsWith('[DEBUG]') ||
      str.startsWith('[INFO]') || str.startsWith('[WARNING]')) {
    return str;
  }

  // Verbesserte Base64-Validierung
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  if (!base64Regex.test(str) || str.length < 4) {
    return str; // Kein Base64, Original zurückgeben
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
    return str; // Fallback: return original if decode fails
  }
}


// ========== SIMPLE & ROBUST API CALL ==========
async function safeAPICall(endpoint, method = 'GET', body = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (body) {
    const bodyString = JSON.stringify(body);
    if (bodyString.length > GEMINI_CONFIG.MAX_RESPONSE_SIZE) {
      throw new Error(`Request zu groß: ${Math.round(bodyString.length / 1024 / 1024)}MB`);
    }
    options.body = bodyString;
  }

  try {
    console.error(`[MCP API] ${method} ${endpoint}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_CONFIG.TIMEOUT);

    const response = await fetch(`${GEMINI_CONFIG.API_BASE_URL}${endpoint}`, {
      ...options,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const responseText = await response.text();

    if (responseText.length > GEMINI_CONFIG.MAX_RESPONSE_SIZE) {
      throw new Error(`Response zu groß: ${Math.round(responseText.length / 1024 / 1024)}MB`);
    }

    const result = JSON.parse(responseText);
    return result;

  } catch (error) {
    console.error(`[MCP ERROR] API Fehler: ${error.message}`);
    throw new Error(`ExpressServer Fehler: ${error.message}`);
  }
}

// ========== MCP SERVER SETUP ==========
const server = new Server(
  {
    name: 'roblox-studio',
    version: '1.0.0-gemini',
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
        name: 'tree',
        description: 'Get the complete hierarchy tree of any Roblox object by path.',
        inputSchema: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description: 'Path to the Roblox object. Examples: "workspace", "workspace.Model"',
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
            luaCode: {
              type: 'string',
              description: 'Lua code for setting properties and attributes. Only obj. and obj:SetAttribute() allowed. Example: "obj.Size = Vector3.new(10,2,10)\\nobj.Anchored = true\\nobj:SetAttribute(\\"Health\\", 100)". (Base64-encoded internally for safe JSON transport)',
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
              description: 'Optional: Define loop variables for batch mode. Keys are variable names, values are objects with "start" and "step". Example: {"x": {"start": 0, "step": 2}, "rot": {"start": 0, "step": 15}}. These variables can be used in "luaCode" (e.g., "obj.Position = Vector3.new(x, 0, 0)").',
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
        description: `Modify an existing Roblox object (properties, source, attributes).

CRITICAL - Script Source Editing:
⚠️  Use modifyObject to change "source" parameter ONLY when replacing MORE THAN 50% of the script
⚠️  For small changes (single lines, functions, variables), ALWAYS use editScript instead
⚠️  modifyObject replaces the ENTIRE script source - all existing code is permanently lost!

WHEN TO USE modifyObject with source parameter:
✅ Complete script rewrite (creating new script from scratch)
✅ Changing more than 50% of existing code
✅ Initial script content creation

WHEN TO USE editScript instead:
✅ Changing single lines or specific functions (< 50% of code)
✅ Updating specific variables, strings, or values
✅ Modifying parts of code while preserving the rest
✅ Any targeted change that doesn't require full rewrite

For properties and attributes:
✅ Use luaCode parameter with obj. assignments for maximum flexibility
✅ Supports all Roblox data types automatically`,
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
        description: `Precise script editing with string replacement.

⚠️  MANDATORY: Use readLine() BEFORE editScript() to read target lines

WORKFLOW:
1. readLine({path: "Script", startLine: 5, endLine: 10})
2. Find text you want to change in the output
3. editScript({path: "Script", old_string: "old text", new_string: "new text"})
4. readLine() again to verify changes

RULES:
- CRITICAL: old_string must match the file content BIT-BY-BIT. If readLine returns 4 spaces indentation, old_string MUST have 4 spaces. Do not trim or format.
- old_string must be from the readLine output (WITHOUT "Line X: " prefix)
- Use real newlines for line breaks, use \\n within strings when you want Lua to interpret it as an escape sequence
- Use editScript for <50% changes, modifyObject for >50% rewrites
- (Base64-encoded internally for safe JSON transport)

EXAMPLE:
{
  "path": "game.ReplicatedStorage.Script",
  "old_string": "local x = 1",
  "new_string": "local x = 999"
}`,
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
        description: `Read specific lines from a script or object source. WORKFLOW: Use readLine() first to analyze the current code, then make changes with deleteLines()/insertLines() or modifyObject(), then use readLine() again to verify the changes worked correctly.

EXAMPLES:
1. Read a single line:
{
  "path": "game.ReplicatedStorage.Script",
  "lineNumber": 10
}

2. Read a range of lines:
{
  "path": "game.ReplicatedStorage.Script",
  "startLine": 10,
  "endLine": 20
}`,
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
        name: 'multi',
        description: 'Execute multiple tool calls sequentially for complex workflows. Unlimited tools per call - no limits! Available tools: tree, create, get, modifyObject, editScript, copy, readLine, deleteLines, insertLines, getScriptInfo, scriptSearch, scriptSearchOnly, delete',
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
                    description: 'Tool name to call: "tree", "create", "get", "modifyObject", "editScript", "copy", "readLine", "deleteLines", "insertLines", "getScriptInfo", "scriptSearch", "scriptSearchOnly", "delete"',
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

// ========== TOOL HANDLERS ==========
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // TREE TOOL
    if (name === 'tree') {
      const { path } = args;

      if (!path) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "path" fehlt',
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await safeAPICall('/api/tree/direct', 'POST', { path });

        if (result.success) {
          const decodedOutput = unifiedDecode(result.output);
          return {
            content: [
              {
                type: 'text',
                text: decodedOutput,
              },
            ],
          };
        } else {
          // Tool Execution Exception - MCP System erkennt dies als echten Fehler
          throw new Error(`tree failed: ${result.error}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // CREATE TOOL
    if (name === 'create') {
      const { className, name: objName, parent, luaCode, source, count, loopVars } = args;

      if (!className || !objName || !parent) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: className, name, und parent sind erforderlich',
            },
          ],
          isError: true,
        };
      }

      try {
        const createArgs = {
          className,
          name: objName,
          parent,
          luaCode: luaCode ? unifiedEncode(luaCode) : null,
          source: source ? unifiedEncode(source) : null,
          count: count || 1,
          loopVars: loopVars || null
        };

        const result = await safeAPICall('/api/create/direct', 'POST', createArgs);

        if (result.success) {
          const decodedOutput = unifiedDecode(result.output);
          return {
            content: [
              {
                type: 'text',
                text: decodedOutput,
              },
            ],
          };
        } else {
          // Tool Execution Exception - MCP System erkennt dies als echten Fehler
          throw new Error(`create failed: ${result.error}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // GET TOOL
    if (name === 'get') {
      const { path, attributes } = args;

      if (!path || !attributes || !Array.isArray(attributes) || attributes.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: path und attributes (nicht-leeres Array) sind erforderlich',
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await safeAPICall('/api/get/direct', 'POST', { path, attributes });

        if (result.success) {
          const decodedOutput = unifiedDecode(result.output);
          return {
            content: [
              {
                type: 'text',
                text: decodedOutput,
              },
            ],
          };
        } else {
          // Tool Execution Exception - MCP System erkennt dies als echten Fehler
          throw new Error(`get failed: ${result.error}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // MODIFYOBJECT TOOL
    if (name === 'modifyObject') {
      const { path, luaCode, source } = args;

      if (!path) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "path" fehlt',
            },
          ],
          isError: true,
        };
      }

      try {
        const modifyObjectArgs = {
          path,
          luaCode: luaCode ? unifiedEncode(luaCode) : null,
          source: source !== undefined && source !== null ? unifiedEncode(source) : null
        };

        const result = await safeAPICall('/api/modifyObject/direct', 'POST', modifyObjectArgs);

        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: unifiedDecode(result.output),
              },
            ],
          };
        } else {
          // Tool Execution Exception - MCP System erkennt dies als echten Fehler
          throw new Error(`modifyObject failed: ${result.error}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // EDITSCRIPT TOOL
    if (name === 'editScript') {
      const { path, old_string, new_string, replace_all } = args;

      // Erweiterte Parameter-Validierung
      if (!path || typeof path !== 'string' || path.trim() === '') {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "path" wird benötigt und muss ein nicht-leerer String sein. Beispiel: "game.Workspace.Script"',
            },
          ],
          isError: true,
        };
      }

      if (!old_string || typeof old_string !== 'string') {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "old_string" wird benötigt und muss ein String sein. Dies ist der zu ersetzende Text.',
            },
          ],
          isError: true,
        };
      }

      if (typeof new_string !== 'string') {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "new_string" wird benötigt und muss ein String sein. Dies ist der neue Text.',
            },
          ],
          isError: true,
        };
      }

      if (old_string.trim() === '') {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "old_string" darf nicht leer sein. Bitte geben Sie den zu ersetzenden Text an.',
            },
          ],
          isError: true,
        };
      }

      if (old_string === new_string) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: "new_string" muss sich von "old_string" unterscheiden. Andernfalls ist keine Änderung erforderlich.',
            },
          ],
          isError: true,
        };
      }

      try {
        const editScriptArgs = {
          path,
          old_string: unifiedEncode(old_string),
          new_string: unifiedEncode(new_string),
          replace_all: replace_all || false
        };

        const result = await safeAPICall('/api/editScript/direct', 'POST', editScriptArgs);

        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: unifiedDecode(result.output),
              },
            ],
          };
        } else {
          // Tool Execution Exception - MCP System erkennt dies als echten Fehler
          throw new Error(`editScript failed: ${result.error}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // CONVERTSCRIPT TOOL
    if (name === 'convertScript') {
      const { path, targetType } = args;

      if (!path || !targetType) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: path und targetType sind erforderlich',
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await safeAPICall('/api/convertScript/direct', 'POST', { path, targetType });

        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: unifiedDecode(result.output),
              },
            ],
          };
        } else {
          throw new Error(`convertScript failed: ${result.error}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // READLINE TOOL
    if (name === 'readLine') {
      const { path, lineNumber, startLine, endLine } = args;

      if (!path) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "path" fehlt',
            },
          ],
          isError: true,
        };
      }

      if (!lineNumber && (!startLine || !endLine)) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Entweder "lineNumber" ODER "startLine" und "endLine" müssen angegeben werden',
            },
          ],
          isError: true,
        };
      }

      if (lineNumber && startLine) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Verwende entweder "lineNumber" ODER "startLine"/"endLine", nicht beides',
            },
          ],
          isError: true,
        };
      }

      try {
        const readArgs = { path, lineNumber, startLine, endLine };

        const result = await safeAPICall('/api/readLine/direct', 'POST', readArgs);

        if (result.success) {
          const decodedOutput = unifiedDecode(result.output);
          return {
            content: [
              {
                type: 'text',
                text: decodedOutput,
              },
            ],
          };
        } else {
          // Tool Execution Exception - MCP System erkennt dies als echten Fehler
          throw new Error(`readLine failed: ${result.error}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // DELETELINES TOOL
    if (name === 'deleteLines') {
      const { path, startLine, endLine } = args;

      if (!path || !startLine || !endLine) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "path", "startLine", und "endLine" sind erforderlich',
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await safeAPICall('/api/deleteLines/direct', 'POST', { path, startLine, endLine });

        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: unifiedDecode(result.output),
              },
            ],
          };
        } else {
          // Tool Execution Exception - MCP System erkennt dies als echten Fehler
          throw new Error(`${name} failed: ${result.error}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // INSERTLINES TOOL
    if (name === 'insertLines') {
      const { path, lineNumber, lines } = args;

      if (!path || !lineNumber || !lines) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "path", "lineNumber", und "lines" sind erforderlich',
            },
          ],
          isError: true,
        };
      }

      if (!Array.isArray(lines)) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: "lines" muss ein Array von Strings sein',
            },
          ],
          isError: true,
        };
      }

      try {
        const encodedLines = lines.map(line => unifiedEncode(line));
        const result = await safeAPICall('/api/insertLines/direct', 'POST', { path, lineNumber, lines: encodedLines });

        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: unifiedDecode(result.output),
              },
            ],
          };
        } else {
          // Tool Execution Exception - MCP System erkennt dies als echten Fehler
          throw new Error(`insertLines failed: ${result.error}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // GETSCRIPTINFO TOOL
    if (name === 'getScriptInfo') {
      const { path } = args;

      if (!path) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "path" fehlt',
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await safeAPICall('/api/getScriptInfo/direct', 'POST', { path });

        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: unifiedDecode(result.output),
              },
            ],
          };
        } else {
          // Tool Execution Exception - MCP System erkennt dies als echten Fehler
          throw new Error(`${name} failed: ${result.error}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // SCRIPTSEARCH TOOL
    if (name === 'scriptSearch') {
      const { searchText, caseSensitive, maxResults } = args;

      if (!searchText || searchText.trim() === '') {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "searchText" wird benötigt und darf nicht leer sein',
            },
          ],
          isError: true,
        };
      }

      try {
        const searchArgs = {
          searchText: searchText.trim(),
          caseSensitive: caseSensitive || false,
          maxResults: maxResults || 50
        };

        const result = await safeAPICall('/api/scriptSearch/direct', 'POST', searchArgs);

        if (result.success) {
          const decodedOutput = unifiedDecode(result.output);
          return {
            content: [
              {
                type: 'text',
                text: decodedOutput,
              },
            ],
          };
        } else {
          // Tool Execution Exception - MCP System erkennt dies als echten Fehler
          throw new Error(`${name} failed: ${result.error}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // SCRIPTSEARCHONLY TOOL
    if (name === 'scriptSearchOnly') {
      const { scriptPath, searchText, caseSensitive, maxResults } = args;

      if (!scriptPath || scriptPath.trim() === '') {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "scriptPath" wird benötigt und darf nicht leer sein',
            },
          ],
          isError: true,
        };
      }

      if (!searchText || searchText.trim() === '') {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "searchText" wird benötigt und darf nicht leer sein',
            },
          ],
          isError: true,
        };
      }

      try {
        const searchArgs = {
          scriptPath: scriptPath.trim(),
          searchText: searchText.trim(),
          caseSensitive: caseSensitive || false,
          maxResults: maxResults || 50
        };

        const result = await safeAPICall('/api/scriptSearchOnly/direct', 'POST', searchArgs);

        if (result.success) {
          const decodedOutput = unifiedDecode(result.output);
          return {
            content: [
              {
                type: 'text',
                text: decodedOutput,
              },
            ],
          };
        } else {
          // Tool Execution Exception - MCP System erkennt dies als echten Fehler
          throw new Error(`${name} failed: ${result.error}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // COPY TOOL
    if (name === 'copy') {
      const { sourcePath, targetPath, newName } = args;

      if (!sourcePath) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "sourcePath" fehlt',
            },
          ],
          isError: true,
        };
      }

      if (!targetPath) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "targetPath" fehlt',
            },
          ],
          isError: true,
        };
      }

      try {
        const copyArgs = {
          sourcePath,
          targetPath,
          newName: newName || null
        };

        const result = await safeAPICall('/api/copy/direct', 'POST', copyArgs);

        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: unifiedDecode(result.output),
              },
            ],
          };
        } else {
          // Tool Execution Exception - MCP System erkennt dies als echten Fehler
          throw new Error(`${name} failed: ${result.error}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // DELETE TOOL
    if (name === 'delete') {
      const { path } = args;

      if (!path) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "path" fehlt',
            },
          ],
          isError: true,
        };
      }

      try {
        const result = await safeAPICall('/api/delete/direct', 'POST', { path });

        if (result.success) {
          return {
            content: [
              {
                type: 'text',
                text: unifiedDecode(result.output),
              },
            ],
          };
        } else {
          // Tool Execution Exception - MCP System erkennt dies als echten Fehler
          throw new Error(`${name} failed: ${result.error}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // MULTI TOOL (Google Gemini Optimized)
    if (name === 'multi') {
      const { calls } = args;

      if (!Array.isArray(calls) || calls.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: 'Error: Parameter "calls" muss ein nicht-leeres Array sein',
            },
          ],
          isError: true,
        };
      }

      // Tool limit removed - unlimited tools per call now supported!
      console.error(`[MCP MULTI] Processing ${calls.length} tool calls (unlimited mode)`);

      const results = [];
      let totalOutputSize = 0;

      // Execute calls sequentially
      for (let i = 0; i < calls.length; i++) {
        const call = calls[i];
        const { tool, args: toolArgs } = call;

        try {
          console.error(`[MCP MULTI] Tool ${i + 1}/${calls.length}: ${tool}`);

          const result = await safeAPICall(`/api/${tool}/direct`, 'POST', toolArgs);

          console.error(`[MCP DEBUG] Result for ${tool}:`, JSON.stringify(result));
          const output = result.success ? unifiedDecode(result.output) : (result.error || 'Unknown error');
          const toolOutput = `[${i + 1}] ${tool.toUpperCase()}: ✅\n${output}\n\n`;

          totalOutputSize += toolOutput.length;

          if (totalOutputSize > GEMINI_CONFIG.MAX_RESPONSE_SIZE / 2) {
            results.push({
              index: i,
              tool,
              status: 'success',
              output: result.success ? 'Success (output truncated for size)' : result.error
            });
          } else {
            results.push({
              index: i,
              tool,
              status: result.success ? 'success' : 'error',
              output: result.success ? unifiedDecode(result.output) : (result.error || 'Unknown error')
            });
          }

          console.error(`[MCP MULTI] Tool ${i + 1}: ✅`);

        } catch (error) {
          console.error(`[MCP MULTI] Tool ${i + 1}: ❌ ${error.message}`);
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
          output += `❌ Error\n${result.output}\n\n`;
        }
      }

      const successCount = results.filter(r => r.status === 'success').length;
      const errorCount = results.filter(r => r.status === 'error').length;
      output += `Summary: ${successCount} succeeded, ${errorCount} failed`;

      console.error(`[MCP MULTI] Completed: ${successCount}/${results.length} successful`);

      return {
        content: [
          {
            type: 'text',
            text: output,
          },
        ],
        isError: errorCount > 0,
      };
    }

    throw new Error(`Unknown tool: ${name}`);

  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error.message}`,
        },
      ],
      isError: true,
    };
  }
});

// ========== CRASH PREVENTION ==========
process.on('uncaughtException', (error) => {
  console.error('[MCP CRASH] Uncaught Exception:', error.message);
  console.error('[MCP CRASH] Server wird beendet');
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[MCP CRASH] Unhandled Rejection:', reason);
  console.error('[MCP CRASH] Server wird beendet');
  process.exit(1);
});

// Safe encoding (no stdout manipulation!)
process.stdin.setDefaultEncoding('utf8');
process.stdout.setDefaultEncoding('utf8');

// ========== START SERVER ==========
console.error('[MCP GEMINI] Starte Server mit Google Gemini Optimierung...');

const transport = new StdioServerTransport();
server.connect(transport).then(() => {
  console.error('✅ MCP Server bereit (Roblox Studio) - Google Gemini Optimized');
  console.error('[MCP GEMINI] Ready für Google Gemini mit 25s Timeout und 50MB Response Limit');
}).catch((error) => {
  console.error('[MCP ERROR] Server start fehlgeschlagen:', error);
  process.exit(1);
});