import { deepStrictEqual } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as esbuild from 'esbuild';

const tempDir = mkdtempSync(join(tmpdir(), 'bxl-bundle-smoke-'));

try {
  const result = await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    minify: false,
    sourcemap: false,
    write: false,
  });

  const bundlePath = join(tempDir, 'bundle.mjs');
  writeFileSync(bundlePath, result.outputFiles[0].text, 'utf8');

  const bundle = await import(`file://${bundlePath}`);

  const input = {
    total: 89.04,
    payments: [
      { status: 'pending', amount: 10 },
      { status: 'captured', amount: 30 },
    ],
  };

  const firstResult = bundle.runNativeJq(
    'first(.payments[] | select(.status == "captured")).amount',
    input,
  );
  deepStrictEqual(firstResult.outputs, [30]);

  const roundedResult = bundle.runNativeJq(
    'ROUND(.total - first(.payments[] | select(.status == "captured")).amount; 2)',
    input,
  );
  deepStrictEqual(roundedResult.outputs, [59.04]);

  const readableResult = bundle.evaluateBxl(
    'ROUND(Total - Payment[Status = "captured"].Amount, 2)',
    input,
    {
      schema: {
        fields: [
          { key: 'total', label: 'Total' },
          {
            key: 'payments',
            label: 'Payment',
            kind: 'array',
            item: {
              fields: [
                { key: 'status', label: 'Status' },
                { key: 'amount', label: 'Amount' },
              ],
            },
          },
        ],
      },
    },
  );
  deepStrictEqual(readableResult.value, 59.04);

  const scopedEqualsCompile = bundle.compileReadableSyntax(
    '[range(0; 3) as $r | ($r = 0)]',
  );
  deepStrictEqual(
    scopedEqualsCompile.source,
    '[range(0; 3) as $r |($r == 0)]',
  );

  const scopedEqualsResult = bundle.evaluateBxl(
    '[range(0; 3) as $r | ($r = 0)]',
    {},
  );
  deepStrictEqual(scopedEqualsResult.value, [true, false, false]);

  const jqStringPredicateInComprehension = bundle.evaluateBxl(
    '[range(0; 2) as $r | ("abc" | startswith("a"))]',
    {},
  );
  deepStrictEqual(jqStringPredicateInComprehension.value, [true, true]);

  console.log('bundled first(filter()).field chain works');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
