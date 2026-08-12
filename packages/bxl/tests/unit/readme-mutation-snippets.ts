import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { completeMutationStatements } from '../../examples/bxl-mutation-fixture-runner.js';

const here = dirname(fileURLToPath(import.meta.url));
const readme = readFileSync(join(here, '../../README.md'), 'utf8');
const blocks = [...readme.matchAll(/```bxl-mutation\n([\s\S]*?)\n```/g)].map((match) => match[1]!);

if (blocks.length !== 1) {
  throw new Error(`Expected one README bxl-mutation block, received ${blocks.length}`);
}

const source = blocks[0]!;
const statements = completeMutationStatements(source);
if (statements.length !== 5) {
  throw new Error(`Expected five framed README mutation statements, received ${statements.length}`);
}
if (!source.includes('"Line Item"[* Taxable].Discount += 0.05;')) {
  throw new Error('README mutation example must advertise [* predicate] compound assignment');
}
if (!source.includes('insert_item_after(') || !source.includes('move_item_before(')) {
  throw new Error('README mutation example must advertise stable structural operations');
}
if (/\b(?:update_all|delete_all|copy_to|insert_after|insert_before)\s*\(/.test(source)) {
  throw new Error('README mutation example contains a deprecated mutation spelling');
}

console.log(`README mutation snippets: ${statements.length} framed statements passed`);
