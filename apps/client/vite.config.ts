import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const API_TARGET = 'http://127.0.0.1:3001';

/**
 * Stale-version detection: every production build gets an id, stamped into the
 * bundle and written to `dist/version.json`, which the running client compares
 * against when the tab regains focus (see src/lib/version-check.ts).
 */
function versionFile(buildId: string): Plugin {
  return {
    name: 'ldg-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: `${JSON.stringify({ buildId })}\n` });
    },
  };
}

export default defineConfig(({ command }) => {
  const buildId = command === 'build' ? new Date().toISOString() : 'dev';
  return {
    plugins: [react(), tailwindcss(), versionFile(buildId)],
    define: {
      __APP_BUILD_ID__: JSON.stringify(buildId),
    },
    resolve: {
      alias: {
        '@ldg/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)),
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': { target: API_TARGET },
      },
    },
    preview: {
      host: '127.0.0.1',
      port: 4173,
      proxy: {
        '/api': { target: API_TARGET },
      },
    },
    build: {
      sourcemap: true,
    },
  };
});
