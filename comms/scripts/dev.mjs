// Runs the API server (with reload) and the Vite dev server together.
// Calls the tools' entry files with this same Node binary, so it works the same on Windows, macOS and Linux
// (no `npx`, no shell, no `VAR=value` syntax).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const tsx = here('node_modules/tsx/dist/cli.mjs');
const vite = here('node_modules/vite/bin/vite.js');
for (const f of [tsx, vite]) {
  if (!existsSync(f)) {
    console.error(`Missing ${f}. Run \`npm install\` in the comms folder first.`);
    process.exit(1);
  }
}

const procs = [
  spawn(process.execPath, [tsx, 'watch', 'server/index.ts'], { stdio: 'inherit', env: { ...process.env, PORT: process.env.PORT ?? '4000' } }),
  spawn(process.execPath, [vite], { stdio: 'inherit' }),
];
let stopping = false;
const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill();
};
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) process.on(sig, stop);
procs.forEach((p) => p.on('exit', stop));
