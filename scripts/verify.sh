#!/usr/bin/env bash
set -euo pipefail

cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
command -v node >/dev/null || { printf 'Node.js 22.13+ is required.\n' >&2; exit 1; }
command -v npm >/dev/null || { printf 'npm is required.\n' >&2; exit 1; }
env_args=()
if [[ -f .env ]]; then
  env_args+=(--env-file=.env)
fi

exec node "${env_args[@]}" --input-type=module <<'NODE'
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

process.env.SQL_INTEGRATION_TESTS = 'true';
process.env.SQL_SAVE_TESTS = 'true';
process.env.SQL_TEST_MODE = 'true';
process.env.SQL_SCHEMA = `touchline_test_verify_${Date.now()}_${process.pid}`;

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
NODE