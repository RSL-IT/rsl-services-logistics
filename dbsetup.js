#!/usr/bin/env node
// ESM-friendly, forwards all env vars to the child process.
// Usage examples:
//   node scripts/dbsetup.js npm run docker-start
//   node scripts/dbsetup.js node server.js

import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/dbsetup.js <command> [args...]');
  process.exit(1);
}

const child = spawn(args[0], args.slice(1), {
  stdio: 'inherit',
  env: process.env, // <-- critical: keep SHOPIFY_* and other secrets visible
});

child.on('exit', (code, signal) => {
  if (signal) {
    // Mirror child signal so Docker/Fly see the real reason
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});
