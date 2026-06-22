/**
 * Repro / verification harness for CS-11033.
 *
 * Part 1 (matrix probe) answers the diagnosis question:
 *   does `canUseTool` fire for tools in `allowedTools` under each
 *   `permissionMode`?
 *
 * Empirical answer (recorded so future readers don't have to re-run):
 *   - Tool in `allowedTools` → SDK auto-approves, hook does NOT fire,
 *     under every permission mode. The factory's path-scoping safety
 *     net (PR #4633) was therefore dead code under `dontAsk` because
 *     `Write` / `Edit` were in `allowedTools`.
 *   - Tool NOT in `allowedTools`:
 *       * `default` → hook fires; allow/deny is honored.   ✓
 *       * `acceptEdits` → hook fires only on deny; allow path
 *                         auto-approves without consulting hook.
 *       * `dontAsk` → hook never fires; SDK silently denies.
 *       * `bypassPermissions` → hook never fires; auto-approves.
 *
 *   Conclusion: the only mode that lets the hook gate fs ops is
 *   `default` + the gated tool removed from `allowedTools`.
 *
 * Part 2 (production probe) verifies the fix in shape: production
 * config (default mode, native fs out of allowedTools, canUseTool
 * scoping by workspaceDir) → in-workspace Write succeeds; absolute
 * out-of-workspace Write is rejected.
 *
 * Usage:
 *   pnpm exec node scripts/canusetool-repro.ts
 *
 * (Auth: works with whatever `claude login` already set up; no
 * ANTHROPIC_API_KEY needed.)
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  query,
  type CanUseTool,
  type Options,
  type PermissionMode,
} from '@anthropic-ai/claude-agent-sdk';

interface Probe {
  mode: PermissionMode;
  toolInAllowed: boolean;
  /** What canUseTool returns when invoked. */
  hookResponse: 'allow' | 'deny';
}

interface ProbeResult extends Probe {
  /** Did the hook fire at all? */
  hookFired: boolean;
  /** Did the Write actually create a file on disk? */
  fileExists: boolean;
  /** Final summary the SDK returned. */
  finalText: string;
  /** Any error caught during the run. */
  error?: string;
}

async function probe(spec: Probe): Promise<ProbeResult> {
  // Fresh empty workspace for each probe so file-existence reads cleanly.
  let dir = mkdtempSync(join(tmpdir(), 'canusetool-repro-'));
  let target = join(dir, 'probed.txt');
  let hookFired = false;

  let canUseTool: CanUseTool = async (toolName, input) => {
    hookFired = true;
    if (spec.hookResponse === 'allow') {
      return { behavior: 'allow', updatedInput: input };
    }
    return {
      behavior: 'deny',
      message: `[probe] denied ${toolName} on ${(input as { file_path?: string }).file_path}`,
    };
  };

  let allowedTools = spec.toolInAllowed ? ['Write'] : [];

  let options: Options = {
    cwd: dir,
    tools: ['Write'],
    allowedTools,
    permissionMode: spec.mode,
    canUseTool,
    settingSources: [],
    maxTurns: 4,
  };

  let prompt = `Use the Write tool to create the file "probed.txt" with the content "hello". Then stop.`;

  let finalText = '';
  let error: string | undefined;
  try {
    let q = query({ prompt, options });
    for await (let msg of q) {
      if (msg.type === 'result') {
        let m = msg as { subtype?: string; result?: string };
        finalText = `${m.subtype ?? ''}: ${m.result ?? ''}`.slice(0, 200);
      }
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  let fileExists = false;
  try {
    let { existsSync } = await import('node:fs');
    fileExists = existsSync(target);
  } catch {
    // best-effort
  }

  rmSync(dir, { recursive: true, force: true });

  return { ...spec, hookFired, fileExists, finalText, error };
}

async function main() {
  let combos: Probe[] = [];
  for (let mode of [
    'default',
    'acceptEdits',
    'dontAsk',
    'bypassPermissions',
  ] as PermissionMode[]) {
    for (let toolInAllowed of [true, false]) {
      for (let hookResponse of ['allow', 'deny'] as const) {
        combos.push({ mode, toolInAllowed, hookResponse });
      }
    }
  }

  let results: ProbeResult[] = [];
  for (let c of combos) {
    process.stderr.write(
      `[probe] mode=${c.mode.padEnd(20)} allowed=${c.toolInAllowed ? 'yes' : 'no '} hook=${c.hookResponse}\n`,
    );
    let r = await probe(c);
    results.push(r);
    process.stderr.write(
      `        → hookFired=${r.hookFired ? 'YES' : 'no '} fileExists=${r.fileExists ? 'YES' : 'no '}${r.error ? ` error=${r.error.slice(0, 80)}` : ''}\n`,
    );
  }

  console.log('\n=== summary table ===');
  console.log(
    'mode'.padEnd(20),
    'inAllowed'.padEnd(10),
    'hookSays'.padEnd(8),
    'hookFired'.padEnd(10),
    'fileExists',
  );
  for (let r of results) {
    console.log(
      r.mode.padEnd(20),
      (r.toolInAllowed ? 'yes' : 'no').padEnd(10),
      r.hookResponse.padEnd(8),
      (r.hookFired ? 'YES' : 'no').padEnd(10),
      r.fileExists ? 'YES' : 'no',
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
