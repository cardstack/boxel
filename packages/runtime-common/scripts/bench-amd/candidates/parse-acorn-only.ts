// Theoretical floor for any acorn-based transpiler: parse the source
// and do nothing else. Used to attribute wall time between parsing
// and the production transform's edits/emits.
import { Parser } from 'acorn';

export const name = 'parse-acorn-only';

export async function transform(
  src: string,
  _moduleId: string,
): Promise<string> {
  Parser.parse(src, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    allowImportExportEverywhere: false,
  });
  return src; // not real output — this candidate is just for parse-cost.
}
