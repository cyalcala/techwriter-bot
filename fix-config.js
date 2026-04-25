import fs from 'fs';
import path from 'path';

const configPath = path.join(process.cwd(), 'dist', 'server', 'wrangler.json');

if (fs.existsSync(configPath)) {
  console.log('🛠️ Fixing Bot Address...');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  
  // 1. Point to the assets (body)
  config.pages_build_output_dir = '../client';
  
  // 2. Remove forbidden names
  delete config.assets;
  
  // 3. Fix compatibility
  config.compatibility_date = '2024-10-01';
  config.compatibility_flags = ['nodejs_compat'];
  
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log('✅ Address fixed! Ready for deployment.');
} else {
  console.error('❌ Could not find the brain config!');
}
