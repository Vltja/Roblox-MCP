import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('='.repeat(60));
console.log('🚀 Roblox MCP Server Wrapper');
console.log('='.repeat(60));

// Start Express Server as child process
console.log('📡 Starte Express Server...');
const serverProcess = spawn('node', ['server-json.js'], {
  cwd: __dirname,
  stdio: 'inherit' // Server logs visible
});

serverProcess.on('error', (err) => {
  console.error('❌ Server konnte nicht gestartet werden:', err);
  process.exit(1);
});

serverProcess.on('exit', (code) => {
  console.log(`📡 Server beendet mit Code: ${code}`);
  process.exit(code);
});

// Wait for server to be ready
console.log('⏳ Warte auf Server-Start (2 Sekunden)...');
setTimeout(() => {
  console.log('🌐 Öffne GUI in Chrome App-Mode...');

  // Find Chrome executable
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
  ];

  let chromePath = 'chrome'; // Fallback to PATH
  for (const p of chromePaths) {
    if (existsSync(p)) {
      chromePath = p;
      break;
    }
  }

  console.log(`📍 Chrome Pfad: ${chromePath}`);

  // Start Chrome in App Mode
  const chromeProcess = spawn(chromePath, [
    '--app=http://localhost:3000/gui',
    '--window-size=1400,900'
  ], {
    stdio: 'ignore',
    detached: false
  });

  chromeProcess.on('error', (err) => {
    console.error('❌ Chrome konnte nicht gestartet werden:', err);
    console.log('🛑 Beende Server...');
    serverProcess.kill('SIGTERM');
    process.exit(1);
  });

  // Monitor Chrome process
  chromeProcess.on('exit', (code) => {
    console.log('🌐 Chrome wurde geschlossen');
    console.log('🛑 Beende Server automatisch...');

    // Kill server process
    serverProcess.kill('SIGTERM');

    // Force kill after 2 seconds if not dead
    setTimeout(() => {
      if (!serverProcess.killed) {
        console.log('⚠️  Server reagiert nicht - Force Kill');
        serverProcess.kill('SIGKILL');
      }
      process.exit(0);
    }, 2000);
  });

  console.log('✅ Wrapper läuft - GUI und Server sind verbunden');
  console.log('ℹ️  GUI schließen = Server wird automatisch beendet');
  console.log('='.repeat(60));
}, 2000);

// Cleanup on wrapper exit
process.on('SIGINT', () => {
  console.log('\n🛑 Wrapper beendet - Stoppe Server...');
  serverProcess.kill('SIGTERM');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Wrapper beendet - Stoppe Server...');
  serverProcess.kill('SIGTERM');
  process.exit(0);
});
