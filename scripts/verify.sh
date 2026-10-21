#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
command -v node >/dev/null || { printf 'Node.js 22.13+ is required.\n' >&2; exit 1; }
command -v npm >/dev/null || { printf 'npm is required.\n' >&2; exit 1; }
env_args=()
if [[ -f .env ]]; then
  env_args+=(--env-file=.env)
fi

exec node "${env_args[@]}" --input-type=module - "$@" <<'NODE'
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readdirSync } from 'node:fs';
import pg from 'pg';

const args = process.argv.slice(2);
if (args.some(argument => argument !== '--parallel')) {
  console.error('Usage: npm run verify -- [--parallel]. Parallel verification requires npm run test:local.');
  process.exit(2);
}

process.env.SQL_INTEGRATION_TESTS = 'true';
process.env.SQL_SAVE_TESTS = 'true';
process.env.SQL_TEST_MODE = 'true';
process.env.SQL_SCHEMA = `touchline_test_verify_${Date.now()}_${process.pid}`;

if (args.includes('--parallel')) {
  if (process.env.TOUCHLINE_TEST_LOCAL !== 'true' || !['127.0.0.1', 'localhost', '::1'].includes(process.env.SQL_HOST ?? '') ||
      process.env.SQL_DATABASE !== 'touchline_checks' || !process.env.SQL_USER || !process.env.SQL_PASSWORD) {
    throw new Error('Parallel verification requires the isolated local SQL wrapper (npm run test:local); remote and gameplay databases are refused.');
  }
  const files = readdirSync('server', { recursive: true })
    .filter(file => file.endsWith('.test.ts')).map(file => `server/${file}`).sort();
  const gameplay = ['server/systems.test.ts', 'server/club-support.test.ts', 'server/registration.test.ts'].filter(existsSync);
  const persistence = ['server/accounts.test.ts', 'server/app.test.ts', 'server/db.test.ts', 'server/saves.test.ts'].filter(existsSync);
  const remaining = files.filter(file => !gameplay.includes(file) && !persistence.includes(file));
  const stamp = randomUUID().replaceAll('-', '');
  const jobs = [
    { name: 'lint', command: ['npm', 'run', 'lint'] },
    { name: 'build', command: ['npm', 'run', 'build'] },
    { name: 'world', command: ['npx', 'vitest', 'run', ...remaining], database: true },
    { name: 'gameplay', command: ['npx', 'vitest', 'run', ...gameplay], database: true },
    { name: 'persistence', command: ['npx', 'vitest', 'run', ...persistence], database: true },
    { name: 'browser', command: ['npm', 'run', 'test:e2e'], database: true },
  ];
  const admin = new pg.Client({
    host: process.env.SQL_HOST, port: Number(process.env.SQL_PORT ?? 5432), database: 'touchline_checks',
    user: process.env.SQL_USER, password: process.env.SQL_PASSWORD, application_name: 'Touchline verify',
  });
  await admin.connect();
  const owned = [];
  const children = new Set();
  const stop = signal => {
    for (const child of children) {
      try { process.kill(-child.pid, signal); } catch {}
    }
  };
  const interrupt = () => stop('SIGINT');
  const terminate = () => stop('SIGTERM');
  process.on('SIGINT', interrupt);
  process.on('SIGTERM', terminate);
  mkdirSync('reports', { recursive: true });
  try {
    for (const job of jobs.filter(job => job.database)) {
      job.database = `touchline_verify_${stamp.slice(0, 16)}_${job.name}`;
      await admin.query(`CREATE DATABASE "${job.database}" LOCALE_PROVIDER builtin BUILTIN_LOCALE 'C.UTF-8' ENCODING 'UTF8' TEMPLATE template0`);
      owned.push(job.database);
    }
    const results = await Promise.all(jobs.map(job => new Promise(resolve => {
      const log = createWriteStream(`reports/verify-${job.name}-${stamp}.log`, { flags: 'wx', mode: 0o600 });
      const environment = { ...process.env };
      if (job.database) environment.SQL_DATABASE = job.database;
      if (job.name === 'browser') {
        environment.TOUCHLINE_E2E_SCHEMA = `touchline_e2e_${randomUUID().replaceAll('-', '')}`;
        environment.SQL_SCHEMA = environment.TOUCHLINE_E2E_SCHEMA;
      }
      console.log(`[verify:${job.name}] START ${job.command.join(' ')}; log ${log.path}`);
      const child = spawn(job.command[0], job.command.slice(1), {
        env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
      });
      children.add(child);
      for (const stream of [child.stdout, child.stderr]) {
        stream.on('data', chunk => {
          log.write(chunk);
          process.stdout.write(`[${job.name}] ${chunk}`);
        });
      }
      child.once('error', error => console.error(`[verify:${job.name}] ${error.message}`));
      child.once('close', code => {
        children.delete(child);
        log.end(() => {
          console.log(`[verify:${job.name}] ${code === 0 ? 'PASS' : 'FAIL'} exit=${code}`);
          resolve({ name: job.name, code });
        });
      });
    })));
    console.log('PARALLEL_VERIFICATION_RESULTS', JSON.stringify(results));
    process.exitCode = results.every(result => result.code === 0) ? 0 : 1;
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', terminate);
    for (const database of owned) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    }
    await admin.end();
  }
} else {
for (const args of [['run', 'lint'], ['run', 'build'], ['test'], ['run', 'test:e2e']]) {
  if (args[1] === 'test:e2e') {
    process.env.TOUCHLINE_E2E_SCHEMA = `touchline_e2e_${randomUUID().replaceAll('-', '')}`;
    process.env.SQL_SCHEMA = process.env.TOUCHLINE_E2E_SCHEMA;
  }
  console.log(`Verifying: npm ${args.join(' ')}`);
  const result = spawnSync('npm', args, { stdio: 'inherit', env: process.env });
  if (result.error) {
    console.error('Unable to execute npm. Check the local Node/npm installation.');
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
}
NODE