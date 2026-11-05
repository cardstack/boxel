// Type-checks the package's own code (ADR 019 §1.10): `pnpm lint:types`.
//
// The package imports Pret UI, whose package exports its `.gts` source, so
// the check reads Pret UI's source, and boxel-ui's where Pret UI imports it,
// under this package's settings. Those packages are written for the host's
// settings (`experimentalDecorators`, and no `verbatimModuleSyntax`, which
// reads boxel-ui's `.ts` files as CommonJS), and their own lints check them
// under those. So this fails on every diagnostic in a file of this package,
// a misuse of a Pret UI component's arguments among them, and passes over
// those in another package's files, saying how many there were.
import { spawnSync } from 'node:child_process';
import { isAbsolute, relative, resolve } from 'node:path';

import { PACKAGE_ROOT } from './module-package.ts';

const DIAGNOSTIC = /^(.+?)\(\d+,\d+\): (?:error|warning) TS\d+:/;

// Whether `file`, as the compiler names it, is one of this package's own.
export function isOwnFile(file: string): boolean {
  let path = relative(PACKAGE_ROOT, resolve(PACKAGE_ROOT, file));
  return (
    !path.startsWith('..') &&
    !isAbsolute(path) &&
    !path.split(/[\\/]/).includes('node_modules')
  );
}

// The compiler's output split into diagnostics, each its first line and the
// lines indented beneath it, sorted into this package's and the others'.
export function ownDiagnostics(output: string): {
  own: string[];
  others: number;
} {
  let own: string[] = [];
  let others = 0;
  let current: { lines: string[]; isOwn: boolean } | undefined;
  let finish = () => {
    if (current) {
      if (current.isOwn) {
        own.push(current.lines.join('\n'));
      } else {
        others++;
      }
    }
    current = undefined;
  };
  for (let line of output.split('\n')) {
    let match = DIAGNOSTIC.exec(line);
    if (match) {
      finish();
      current = { lines: [line], isOwn: isOwnFile(match[1]) };
    } else if (current && /^\s/.test(line)) {
      current.lines.push(line);
    } else {
      finish();
      if (line.trim()) {
        // Output the compiler gives without a file, such as a bad option.
        own.push(line);
      }
    }
  }
  finish();
  return { own, others };
}

if (import.meta.main) {
  let result = spawnSync('ember-tsc', ['--noEmit', '--pretty', 'false'], {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  let { own, others } = ownDiagnostics(`${result.stdout}${result.stderr}`);
  if (others > 0) {
    console.log(
      `${others} diagnostic${others === 1 ? '' : 's'} in other packages' source, which their own lints check, passed over`,
    );
  }
  if (own.length > 0) {
    console.error(own.join('\n'));
    process.exit(1);
  }
  if (result.status !== 0 && others === 0) {
    process.exit(result.status ?? 1);
  }
}
