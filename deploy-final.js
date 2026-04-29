import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

try {
  console.log('🧪 Starting Final Unified Deployment...');

  // 1. Build the project (Skipped - run manually with npx --max-old-space-size=4096 astro build)
  console.log('📦 Skipping Build (Manually Completed)...');
  // execSync('npm run build', { stdio: 'inherit' });

  const distDir = path.join(process.cwd(), 'dist');
  const clientDir = path.join(distDir, 'client');
  const serverDir = path.join(distDir, 'server');

  // 2. Move the Brain (worker-entry*.mjs -> _worker.js) to the client folder
  const serverFiles = fs.readdirSync(serverDir);
  const workerEntry = serverFiles.find(f => f.startsWith('worker-entry') && f.endsWith('.mjs'));
  const workerTarget = path.join(clientDir, '_worker.js');
  
  if (workerEntry) {
    const serverEntryPath = path.join(serverDir, workerEntry);
    fs.copyFileSync(serverEntryPath, workerTarget);
    console.log(`✅ Brain (${workerEntry} -> _worker.js) placed in deployment root.`);
  } else {
    // Fallback to legacy entry.mjs if found
    const legacyEntry = path.join(serverDir, 'entry.mjs');
    if (fs.existsSync(legacyEntry)) {
      fs.copyFileSync(legacyEntry, workerTarget);
      console.log('✅ Brain (entry.mjs -> _worker.js) placed in deployment root.');
    } else {
      throw new Error('CRITICAL: No worker-entry*.mjs or entry.mjs found in dist/server! Build failed.');
    }
  }

  // 3. Move the Muscles (Chunks) to the client folder
  const serverChunks = path.join(serverDir, 'chunks');
  const clientChunks = path.join(clientDir, 'chunks');
  if (fs.existsSync(serverChunks)) {
    if (!fs.existsSync(clientChunks)) fs.mkdirSync(clientChunks, { recursive: true });
    fs.cpSync(serverChunks, clientChunks, { recursive: true });
    console.log('✅ Muscles (Chunks) moved to client.');
  }

  // 4. Move the Instructions (Middleware) to the client folder
  const midPath = path.join(serverDir, 'virtual_astro_middleware.mjs');
  if (fs.existsSync(midPath)) {
    fs.cpSync(midPath, path.join(clientDir, 'virtual_astro_middleware.mjs'));
    console.log('✅ Instructions (Middleware) moved to client.');
  }

  // 5. Remove any .assetsignore that might block upload
  const ignorePath = path.join(clientDir, '.assetsignore');
  if (fs.existsSync(ignorePath)) {
    fs.unlinkSync(ignorePath);
    console.log('🧹 Vaporized .assetsignore (Unblocking upload).');
  }

  // 5. PURGE only the INTERNAL configs and cache, KEEP the root wrangler.json
  const internalConfigs = [
    path.join(distDir, 'wrangler.json'),
    path.join(serverDir, 'wrangler.json')
  ];
  
  for (const config of internalConfigs) {
    if (fs.existsSync(config)) {
      fs.unlinkSync(config);
      console.log(`🧹 Vaporized Internal Config: ${config}`);
    }
  }

  // Ensure root wrangler.json exists with Clean Slate overrides
  const cleanSlateConfig = {
    "name": "tw-bot",
    "compatibility_date": "2024-11-01",
    "pages_build_output_dir": "dist/client",
    "ai": {
      "binding": "AI"
    },
    "kv_namespaces": [
      {
        "binding": "SESSION",
        "id": "ad577f3ebe2c4cd3bb1542f1e6caf081"
      }
    ],
    "compatibility_flags": [
      "nodejs_compat"
    ]
  };
  fs.writeFileSync('wrangler.json', JSON.stringify(cleanSlateConfig, null, 2));
  
  const wranglerCache = path.join(process.cwd(), '.wrangler');
  if (fs.existsSync(wranglerCache)) {
    fs.rmSync(wranglerCache, { recursive: true, force: true });
    console.log('🧼 Cache wiped.');
  }

  // 6. Deploy using the root wrangler.json
  console.log('🚀 Deploying Unified Package with Clean Slate...');
  execSync('npx wrangler pages deploy dist/client --project-name tw-bot --branch main --commit-dirty=true', { stdio: 'inherit' });
  
} catch (error) {
  console.error('❌ Final Deployment Failed:', error);
  process.exit(1);
}
