import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildApp } from './app.js';
import { isLoopbackHost, loadConfig } from './config/env.js';

// Paths are resolved from this file so they work from both src/ (tsx) and dist/ (node).
const serverRoot = resolve(import.meta.dirname, '..');
const envFile = resolve(serverRoot, '.env');
const clientDist = resolve(serverRoot, '../client/dist');

if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const { version } = JSON.parse(readFileSync(resolve(serverRoot, 'package.json'), 'utf8')) as { version: string };
const serveClient = process.argv.includes('--serve-client');

if (serveClient && !existsSync(resolve(clientDist, 'index.html'))) {
  console.error('Client build not found. Run "npm run build" from the repository root first.');
  process.exit(1);
}

const config = loadConfig(process.env, {
  version,
  clientDistDir: serveClient ? clientDist : null,
});

const app = await buildApp(config);

if (!isLoopbackHost(config.host)) {
  app.log.warn({ host: config.host }, 'Server is bound to a non-loopback address and is reachable from the network.');
}

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  await app.close();
  process.exit(0);
}

process.once('SIGINT', (signal) => void shutdown(signal));
process.once('SIGTERM', (signal) => void shutdown(signal));

try {
  await app.listen({ host: config.host, port: config.port });
  app.log.info(
    { transcriptionConfigured: config.groqApiKey !== null, servingClient: serveClient },
    'Linguas de Gato server ready',
  );
} catch (error) {
  app.log.error({ err: error }, 'failed to start');
  process.exit(1);
}
