import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { loadConfig } from './config/env.js';

const serverRoot = resolve(import.meta.dirname, '..');
let version = '0.1.0';
try {
  const pkg = JSON.parse(readFileSync(resolve(serverRoot, 'package.json'), 'utf8')) as { version: string };
  version = pkg.version;
} catch {
  // Fallback if package.json cannot be read directly from the bundle path
}

const config = loadConfig(process.env, {
  version,
  clientDistDir: null, // SPA client is served statically by Vercel CDN
});

const app = await buildApp(config);
await app.ready();

export default app;
