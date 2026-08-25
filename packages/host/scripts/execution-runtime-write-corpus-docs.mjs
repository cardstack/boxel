/**
 * Rewrite the wild-corpus doc's generated table from the executable manifest.
 *
 * The manifest is the source of truth for the 50 cards; the doc's table is a
 * rendering of it. A Node test asserts the two agree, so a manifest edit that
 * skips this script fails the build rather than leaving the doc quietly
 * describing a different list.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  wildCorpusDocPath,
  withRenderedWildCorpusTable,
} from './execution-runtime-wild-corpus.mjs';

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
);
const docFile = join(repoRoot, wildCorpusDocPath);

let current = readFileSync(docFile, 'utf8');
let next = withRenderedWildCorpusTable(current);
if (current === next) {
  console.log(`${wildCorpusDocPath} is already current.`);
} else {
  writeFileSync(docFile, next);
  console.log(`Rewrote the generated table in ${wildCorpusDocPath}.`);
}
