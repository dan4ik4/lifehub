import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const venv = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = process.env.LIFEHUB_TEST_PYTHON || (existsSync(venv) ? venv : 'python');

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.pw.ts',
  workers: 1,
  timeout: 180_000,
  use: {
    baseURL: 'http://127.0.0.1:5196',
    channel: process.env.LIFEHUB_TEST_BROWSER || undefined,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `"${python}" -m uvicorn tests.overview_smoke_app:app --host 127.0.0.1 --port 8026`,
      cwd: root,
      env: { LIFEHUB_QA_REAL_AI: '0', LIFEHUB_QA_REAL_VOICE: '0' },
      url: 'http://127.0.0.1:8026/health/ready',
    },
    {
      command: 'pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 5196 --strictPort',
      timeout: 120_000,
      env: { LIFEHUB_API_TARGET: 'http://127.0.0.1:8026', VITE_GOOGLE_CLIENT_ID: '', VITE_APPLE_CLIENT_ID: '' },
      url: 'http://127.0.0.1:5196',
    },
  ],
});
