import 'dotenv/config';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildBoxelProgram } from './build-program';
import { setQuiet } from './lib/cli-log';

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, '../package.json'), 'utf-8'),
);

// `--quiet` is implemented by intercepting `console.log/info/debug`.
// New commands: write decorative output (status, confirmations, colored
// lines) with `console.log` — it's silenced for free under `--quiet`.
// For programmatic output (`--json` payloads, raw file bytes), use
// `cliLog.output(...)`. Full guidance: see `lib/cli-log.ts`.
//
// Belt-and-suspenders: also flip quiet mode based on a raw scan of argv,
// so any code that runs between Commander's option parsing and the
// `preAction` hook sees the right state. We scan for the long form only;
// `-q` could legitimately be the value of another option in the future.
if (process.argv.includes('--quiet')) {
  setQuiet(true);
}

buildBoxelProgram(pkg.version).parse();
