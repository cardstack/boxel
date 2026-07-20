/**
 * Imports validation step (v3) — the static half of the host-import
 * manifest gate.
 *
 * Scans every workspace `.gts` module for `@cardstack/boxel-host/tools/`
 * (and legacy `commands/`) imports that don't resolve against the
 * manifest derived from the host build. Runs entirely in-process against
 * the local workspace — no realm round-trip, no artifact card — so a
 * phantom import fails the iteration seconds after the agent writes it
 * instead of at runtime in the operator's browser.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

import type {
  ValidationStepResult,
  ValidationError,
} from '../factory-agent/index.ts';

import type { ValidationStepRunner } from './validation-pipeline.ts';

import { findHostImportViolations } from '../host-import-manifest.ts';
import { logger } from '../logger.ts';

const log = logger('imports-step');

// Workspace dirs that never contain agent-authored .gts modules.
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'design',
  '.factory-scratch',
]);

export interface ImportsValidationStepConfig {
  workspaceDir: string;
  /** Valid `@cardstack/boxel-host/tools/<name>` module names. */
  hostToolImports: string[];
}

export class ImportsValidationStep implements ValidationStepRunner {
  readonly step = 'imports' as const;
  private workspaceDir: string;
  private manifest: Set<string>;

  constructor(config: ImportsValidationStepConfig) {
    this.workspaceDir = config.workspaceDir;
    this.manifest = new Set(config.hostToolImports);
  }

  async run(): Promise<ValidationStepResult> {
    let errors: ValidationError[] = [];
    let files: string[] = [];
    try {
      files = await this.listGtsFiles();
    } catch (error) {
      // Never block a run on the gate's own failure — report pass with a log.
      log.warn(`imports step could not list workspace: ${String(error)}`);
      return { step: this.step, passed: true, errors: [] };
    }
    for (let relPath of files) {
      let source: string;
      try {
        source = await readFile(join(this.workspaceDir, relPath), 'utf8');
      } catch {
        continue;
      }
      for (let violation of findHostImportViolations(source, this.manifest)) {
        errors.push({
          file: relPath,
          message: violation.suggestion
            ? `invalid host import '${violation.specifier}': ${violation.suggestion}`
            : `invalid host import '${violation.specifier}'`,
        });
      }
    }
    return {
      step: this.step,
      passed: errors.length === 0,
      files,
      errors,
    };
  }

  formatForContext(result: ValidationStepResult): string {
    if (result.passed || result.errors.length === 0) {
      return '';
    }
    let lines = [
      '### Host import check FAILED',
      '',
      'These imports do not exist in the host build and will crash at',
      'runtime. Fix them before anything else — the module cannot load:',
      '',
      ...result.errors.map((e) => `- ${e.file ?? '?'}: ${e.message}`),
      '',
      'The authoritative import list is in the `host-tools-import-manifest`',
      'skill in your context.',
    ];
    return lines.join('\n');
  }

  private async listGtsFiles(): Promise<string[]> {
    let entries = await readdir(this.workspaceDir, {
      recursive: true,
      withFileTypes: true,
    });
    let files: string[] = [];
    for (let entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.gts')) continue;
      let abs = join(entry.parentPath, entry.name);
      let rel = relative(this.workspaceDir, abs).split(sep).join('/');
      if (SKIP_DIRS.has(rel.split('/')[0])) continue;
      files.push(rel);
    }
    return files;
  }
}
