import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

try {
  console.log('🧪 Starting Final Unified Deployment...');

  // 1. Build the project
  console.log('📦 Building Astro...');
  execSync('npm run build', { stdio: 'inherit' });

  const distDir = path.join(process.cwd(), 'dist');
  const clientDir = path.join(distDir, 'client');
  const serverDir = path.join(distDir, 'server');

  // 2. Move the Brain (entry.mjs -> _worker.js) to the client folder
  fs.cpSync(path.join(serverDir, 'entry.mjs'), path.join(clientDir, '_worker.js'));
  console.log('✅ Brain (Worker) moved to client.');

  // 3. Move the Muscles (Chunks) to the client folder
  fs.cpSync(path.join(serverDir, 'chunks'), path.join(clientDir, 'chunks'), { recursive: true });
  console.log('✅ Muscles (Chunks) moved to client.');

  // 4. Move the Instructions (Middleware) to the client folder
  const midPath = path.join(serverDir, 'virtual_astro_middleware.mjs');
  if (fs.existsSync(midPath)) {
    fs.cpSync(midPath, path.join(clientDir, 'virtual_astro_middleware.mjs'));
    console.log('✅ Instructions (Middleware) moved to client.');
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
    "compatibility_date": "2024-10-01",
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
