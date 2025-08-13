#!/usr/bin/env tsx
/*
 * Enhanced Scripts Test Runner
 * Orchestrates execution of enhanced script tests in the scripts/ package.
 *
 * Usage:
 *   tsx tests/run-all-tests.ts              # run default set (near-to-eth, eth-to-near)
 *   tsx tests/run-all-tests.ts all          # same as default
 *   tsx tests/run-all-tests.ts near-to-eth  # only NEAR -> ETH flow
 *   tsx tests/run-all-tests.ts eth-to-near  # only ETH -> NEAR flow
 *   tsx tests/run-all-tests.ts monitor      # run monitor (may be long-running)
 */

import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Pretty logger
const log = {
  info: (msg: string, extra?: Record<string, unknown>) =>
    console.log(`[runner] ${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}`),
  error: (msg: string, extra?: Record<string, unknown>) =>
    console.error(`[runner] ERROR: ${msg}${extra ? ` ${JSON.stringify(extra)}` : ''}`)
};

/** A single runnable task */
interface Task {
  readonly name: string;
  readonly cmd: string;
  readonly args: readonly string[];
  readonly cwd?: string;
}

/** Spawn a command and return exit code with duration */
async function runTask(task: Task): Promise<{ name: string; code: number; durationMs: number }>
{
  const start = Date.now();
  log.info(`Starting: ${task.name}`, { cmd: task.cmd, args: task.args });

  const child = spawn(task.cmd, task.args, {
    cwd: task.cwd ?? process.cwd(),
    stdio: 'inherit',
    env: process.env
  });

  const [code] = (await once(child, 'exit')) as [number | null, NodeJS.Signals | null];
  const durationMs = Date.now() - start;
  const exitCode = code ?? 0;

  if (exitCode === 0) {
    log.info(`Completed: ${task.name}`, { durationMs });
  } else {
    log.error(`Failed: ${task.name}`, { exitCode, durationMs });
  }

  return { name: task.name, code: exitCode, durationMs };
}

/** Build task list based on target */
function getTasks(target: string): Task[] {
  const base: Task[] = [
    {
      name: 'near-to-eth:enhanced',
      cmd: 'tsx',
      args: ['src/enhanced-test-near-to-eth-transfer.ts']
    },
    {
      name: 'eth-to-near:enhanced',
      cmd: 'tsx',
      args: ['src/enhanced-eth-to-near-transfer.ts']
    }
  ];

  if (target === 'all' || target === '') return base;
  if (target === 'near-to-eth') return [base[0]];
  if (target === 'eth-to-near') return [base[1]];
  if (target === 'monitor') {
    return [
      {
        name: 'monitor:enhanced',
        cmd: 'tsx',
        args: ['src/enhanced-monitor-relayer.ts']
      }
    ];
  }

  log.error('Unknown target. Supported: all | near-to-eth | eth-to-near | monitor');
  process.exitCode = 2;
  return [];
}

async function main() {
  const target = (process.argv[2] ?? 'all').trim();
  const tasks = getTasks(target);
  if (tasks.length === 0) return;

  log.info('Running tasks', { count: tasks.length, target });

  const results = [] as { name: string; code: number; durationMs: number }[];
  for (const t of tasks) {
    // Run sequentially for deterministic output
    // eslint-disable-next-line no-await-in-loop
    const r = await runTask(t);
    results.push(r);
    if (r.code !== 0) break; // stop on first failure
  }

  // Summary
  const totalMs = results.reduce((acc, r) => acc + r.durationMs, 0);
  const failed = results.find((r) => r.code !== 0);

  console.log('\n===== Test Summary =====');
  for (const r of results) {
    console.log(`- ${r.name}: ${r.code === 0 ? 'PASS' : 'FAIL'} (${r.durationMs} ms)`);
  }
  console.log(`Total duration: ${totalMs} ms`);

  process.exitCode = failed ? failed.code : 0;
}

main().catch((err) => {
  log.error('Unhandled error in test runner', { message: err?.message });
  process.exitCode = 1;
});
