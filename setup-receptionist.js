import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const distDir = path.join(process.cwd(), 'dist');
const serverDir = path.join(distDir, 'server');
const configPath = path.join(serverDir, 'wrangler.json');

try {
  console.log('🧪 Starting Gentle Fusion Protocol...');

  // 1. Fix the Astro-generated config
  if (fs.existsSync(configPath)) {
    console.log('🛠️ Surgically correcting the config...');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    
    config.pages_build_output_dir = '../client';
    delete config.assets;
    config.compatibility_date = '2024-10-01';
    config.compatibility_flags = ['nodejs_compat'];
    
    // Most important: Remove the "main" key if we want to deploy as Pages
    // Wait, no, Pages WITH a worker needs "main".
    // But Cloudflare is picky. Let's try removing it and see if it uses the default _worker.js.
    
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    console.log('✅ Config corrected.');
  }

  // 2. VAPORIZE ONLY the Wrangler cache
  const wranglerCache = path.join(process.cwd(), '.wrangler');
  if (fs.existsSync(wranglerCache)) {
    fs.rmSync(wranglerCache, { recursive: true, force: true });
    console.log('🧼 Cache wiped.');
  }

  // 3. Deploy
  console.log('🚀 Deploying Unified Bot to Production...');
  execSync('npx wrangler pages deploy dist/server --project-name tw-bot --branch main --commit-dirty=true', { stdio: 'inherit' });
  
} catch (error) {
  console.error('❌ Deployment Failed:', error);
  process.exit(1);
}
