// CLI for the `@context` search codemod. Dry-run by default; pass `--write` to
// apply. Walks the given files/directories for `.gts` card source, migrates the
// usages it can transform mechanically, and reports the ones it can't so they
// can be migrated by hand.
//
//   node scripts/codemod/context-search/run.ts <path…> [--write]

import { readFileSync, writeFileSync, statSync, readdirSync } from 'fs';
import { join, resolve } from 'path';

import * as prettier from 'prettier';

import { transformContextSearch } from './transform.ts';

// Format the migrated source through the repo's prettier config (with
// prettier-plugin-ember-template-tag for `.gts`) so the structural edits land as
// clean, repo-consistent output rather than the transformer's raw whitespace.
async function formatGts(code: string, filepath: string): Promise<string> {
  try {
    let config = await prettier.resolveConfig(filepath);
    return await prettier.format(code, {
      ...config,
      filepath: resolve(filepath),
    });
  } catch (err) {
    console.warn(
      `  ! prettier could not format ${filepath} (${(err as Error).message}); wrote unformatted`,
    );
    return code;
  }
}

function collectGtsFiles(paths: string[]): string[] {
  let out: string[] = [];
  for (let path of paths) {
    let stat = statSync(path);
    if (stat.isDirectory()) {
      for (let entry of readdirSync(path)) {
        if (entry === 'node_modules' || entry.startsWith('.')) {
          continue;
        }
        out.push(...collectGtsFiles([join(path, entry)]));
      }
    } else if (path.endsWith('.gts')) {
      out.push(path);
    }
  }
  return out;
}

async function main(): Promise<void> {
  let args = process.argv.slice(2);
  let write = args.includes('--write');
  let paths = args.filter((a) => !a.startsWith('--'));
  if (paths.length === 0) {
    console.error(
      'usage: node scripts/codemod/context-search/run.ts <file-or-dir>… [--write]',
    );
    process.exit(2);
  }

  let files = collectGtsFiles(paths);
  let transformed: string[] = [];
  let reported: { file: string; reasons: string[] }[] = [];

  for (let file of files) {
    let source = readFileSync(file, 'utf8');
    let result = transformContextSearch(source, { filename: file });
    if (result.status === 'transformed') {
      transformed.push(file);
      if (write && result.output !== source) {
        writeFileSync(file, await formatGts(result.output, file));
      }
    }
    // A file may be both transformed (some usages) and reported (others).
    if (result.reasons.length > 0) {
      reported.push({ file, reasons: result.reasons });
    }
  }

  let verb = write ? 'Migrated' : 'Would migrate';
  console.log(`Scanned ${files.length} .gts file(s).`);
  console.log(`\n${verb} ${transformed.length} file(s):`);
  for (let file of transformed) {
    console.log(`  ✓ ${file}`);
  }

  if (reported.length > 0) {
    console.log(
      `\nReported ${reported.length} file(s) for hand migration (CS-11536):`,
    );
    for (let { file, reasons } of reported) {
      console.log(`  • ${file}`);
      for (let reason of reasons) {
        console.log(`      - ${reason}`);
      }
    }
  }

  if (!write && transformed.length > 0) {
    console.log('\nRe-run with --write to apply.');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
