import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const distClient = path.join(process.cwd(), 'dist', 'client');
const distServer = path.join(process.cwd(), 'dist', 'server');
const workerDir = path.join(distClient, '_worker.js');

try {
  // Ensure the _worker.js directory exists
  if (!fs.existsSync(workerDir)) {
    fs.mkdirSync(workerDir, { recursive: true });
  }

  // Move all files from dist/server to dist/client/_worker.js
  if (fs.existsSync(distServer)) {
    const files = fs.readdirSync(distServer);
    for (const file of files) {
      const oldPath = path.join(distServer, file);
      const newPath = path.join(workerDir, file);
      fs.cpSync(oldPath, newPath, { recursive: true }); // use cpSync instead of rename to avoid cross-device link errors
    }
  }

  // Rename entry.mjs to index.js
  const entryPath = path.join(workerDir, 'entry.mjs');
  const indexPath = path.join(workerDir, 'index.js');
  if (fs.existsSync(entryPath)) {
    fs.renameSync(entryPath, indexPath);
    console.log('✅ Successfully structured _worker.js for Cloudflare Pages!');
  } else {
    console.log('⚠️ entry.mjs not found. Already renamed?');
  }

  // Run wrangler deploy
  console.log('🚀 Deploying to Cloudflare Pages...');
  execSync('npx wrangler pages deploy dist/client --project-name tw-bot', { stdio: 'inherit' });
  
} catch (error) {
  console.error('❌ Deployment failed:', error);
  process.exit(1);
}
