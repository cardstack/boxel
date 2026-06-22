/**
 * Quick fix-verification harness for CS-11033. Mirrors the production
 * options shape (default mode, native fs OUT of allowedTools, canUseTool
 * scoping by workspaceDir) and confirms:
 *   - in-workspace Write succeeds
 *   - absolute out-of-workspace Write is denied
 *
 * Faster than the full matrix repro — two probes instead of sixteen.
 *
 * Usage:
 *   pnpm exec node scripts/canusetool-fix-verify.ts
 */

import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  query,
  type CanUseTool,
  type Options,
} from '@anthropic-ai/claude-agent-sdk';

interface Result {
  scenario: 'inside' | 'outside';
  hookFired: boolean;
  hookDecision: 'allow' | 'deny' | 'none';
  fileCreated: boolean;
  error?: string;
}

async function probe(scenario: 'inside' | 'outside'): Promise<Result> {
  let workspace = mkdtempSync(join(tmpdir(), 'canusetool-prod-'));
  let workspaceCanonical = realpathSync(workspace);
  let outsideDir = mkdtempSync(join(tmpdir(), 'canusetool-outside-'));

  let hookFired = false;
  let hookDecision: 'allow' | 'deny' | 'none' = 'none';

  let canUseTool: CanUseTool = async (toolName, input) => {
    hookFired = true;
    if (toolName !== 'Write' && toolName !== 'Edit' && toolName !== 'Read') {
      hookDecision = 'allow';
      return { behavior: 'allow', updatedInput: input };
    }
    let raw = (input as { file_path?: unknown }).file_path;
    if (typeof raw !== 'string') {
      hookDecision = 'allow';
      return { behavior: 'allow', updatedInput: input };
    }
    let absolute = isAbsolute(raw) ? raw : resolve(workspaceCanonical, raw);
    let canonical = (() => {
      try {
        return realpathSync(absolute);
      } catch {
        return absolute;
      }
    })();
    let rel = relative(workspaceCanonical, canonical);
    let escapes = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
    if (escapes) {
      hookDecision = 'deny';
      return {
        behavior: 'deny',
        message: `Refusing ${toolName} on "${raw}": outside workspace`,
      };
    }
    hookDecision = 'allow';
    return { behavior: 'allow', updatedInput: input };
  };

  let prompt =
    scenario === 'inside'
      ? `Use the Write tool to create the file "inside.txt" with the content "hi". Then stop.`
      : `Use the Write tool to create the file at the absolute path "${join(outsideDir, 'outside.txt')}" with the content "hi". Then stop.`;

  let target =
    scenario === 'inside'
      ? join(workspaceCanonical, 'inside.txt')
      : join(outsideDir, 'outside.txt');

  let options: Options = {
    cwd: workspace,
    tools: ['Write'],
    allowedTools: [],
    permissionMode: 'default',
    canUseTool,
    settingSources: [],
    maxTurns: 4,
  };

  let error: string | undefined;
  try {
    let q = query({ prompt, options });
    for await (let _msg of q) {
      // drain stream
    }
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  let fileCreated = existsSync(target);

  rmSync(workspace, { recursive: true, force: true });
  rmSync(outsideDir, { recursive: true, force: true });

  return { scenario, hookFired, hookDecision, fileCreated, error };
}

async function main() {
  for (let scenario of ['inside', 'outside'] as const) {
    process.stderr.write(`[probe] scenario=${scenario}\n`);
    let r = await probe(scenario);
    process.stderr.write(
      `        → hookFired=${r.hookFired ? 'YES' : 'no '} hookDecision=${r.hookDecision} fileCreated=${r.fileCreated ? 'YES' : 'no '}${r.error ? ` error=${r.error.slice(0, 100)}` : ''}\n`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
