import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const distDir = path.join(process.cwd(), 'dist');
const clientDir = path.join(distDir, 'client');
const serverDir = path.join(distDir, 'server');

try {
  console.log('🧪 Starting Universal Fusion Protocol...');

  // 1. Move Body (Client Assets) to root
  if (fs.existsSync(clientDir)) {
    const files = fs.readdirSync(clientDir);
    for (const file of files) {
      fs.cpSync(path.join(clientDir, file), path.join(distDir, file), { recursive: true });
    }
  }

  // 2. Move the Brain (All .mjs files) and Muscle (Chunks) to root
  if (fs.existsSync(serverDir)) {
    const files = fs.readdirSync(serverDir);
    for (const file of files) {
      if (file.endsWith('.mjs')) {
        const targetName = (file === 'entry.mjs') ? '_worker.js' : file;
        fs.cpSync(path.join(serverDir, file), path.join(distDir, targetName));
      }
    }
    const chunksDir = path.join(serverDir, 'chunks');
    if (fs.existsSync(chunksDir)) {
      fs.cpSync(chunksDir, path.join(distDir, 'chunks'), { recursive: true });
    }
  }

  // 3. UNIVERSAL SURGERY: Recursively fix all relative paths
  function walkAndFix(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        walkAndFix(fullPath);
      } else if (file.endsWith('.mjs') || file.endsWith('.js')) {
        let content = fs.readFileSync(fullPath, 'utf-8');
        if (content.includes('../virtual_astro_middleware.mjs')) {
          content = content.replace(/\.\.\/virtual_astro_middleware\.mjs/g, './virtual_astro_middleware.mjs');
          fs.writeFileSync(fullPath, content);
          console.log(`🧠 Fixed paths in: ${file}`);
        }
      }
    }
  }
  walkAndFix(distDir);

  // 4. Deploy
  console.log('🚀 Deploying Unified Bot to Production...');
  execSync('npx wrangler pages deploy dist --project-name tw-bot --branch main --commit-dirty=true', { stdio: 'inherit' });
  
} catch (error) {
  console.error('❌ Fusion Failed:', error);
  process.exit(1);
}
