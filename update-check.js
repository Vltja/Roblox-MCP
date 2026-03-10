import { exec } from 'child_process';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const currentVersion = require('./package.json').version;

export function checkForUpdates() {
  exec('npm view roblox-mcp-vitja version', (error, stdout, stderr) => {
    if (error) {
      // Silently fail - don't block startup
      return;
    }
    
    const latestVersion = stdout.trim();
    
    if (latestVersion && latestVersion !== currentVersion) {
      console.error('');
      console.error('╔════════════════════════════════════════════════════════════╗');
      console.error('║  📦 UPDATE AVAILABLE!                                      ║');
      console.error('║                                                            ║');
      console.error(`║  Current: v${currentVersion.padEnd(48)}║`);
      console.error(`║  Latest:  v${latestVersion.padEnd(48)}║`);
      console.error('║                                                            ║');
      console.error('║  Run: npm update -g roblox-mcp-vitja                       ║');
      console.error('╚════════════════════════════════════════════════════════════╝');
      console.error('');
    }
  });
}
