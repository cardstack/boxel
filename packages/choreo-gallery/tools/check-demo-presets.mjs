/* eslint-disable n/no-missing-import -- /app imports run inside the Vite-served browser. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { chromium } from 'playwright';
const catalogIds = [
  ...readFileSync(
    new URL('../test-app/app/lib/catalog.ts', import.meta.url),
    'utf8',
  ).matchAll(/^ {4}id: '([^']+)'/gm),
].map((match) => match[1]);
const ids = process.argv.length > 2 ? process.argv.slice(2) : catalogIds;
const b = await chromium.launch();
try {
  for (let i = 0; i < ids.length; i += 1) {
    await Promise.all(
      ids.slice(i, i + 1).map(async (id) => {
        const p = await b.newPage();
        p.setDefaultTimeout(60000);
        const errors = [];
        p.on('pageerror', (e) => errors.push(e.message));
        await p.goto(
          (process.env.DEMO_BASE_URL ?? 'http://localhost:4592') +
            '/playground/' +
            id,
          { waitUntil: 'domcontentloaded' },
        );
        const versions = p
          .getByRole('button', { name: 'Versions', exact: true })
          .last();
        await versions.press('Enter');
        const names = await p.locator('.dialkit-preset-name').allTextContents();
        assert.equal(names.length, 3, id + ': two presets');
        for (const name of names.slice(1)) {
          await p
            .getByRole('menuitemradio', { name, exact: true })
            .press('Enter');
          const result = await p.evaluate(async (id) => {
            const { demoTuning } = await import('/app/lib/demo-tuning.ts');
            const { demoPresets } = await import('/app/lib/demo-presets.ts');
            return {
              values: demoTuning(id).values,
              definitions: demoTuning(id).definitions,
              presets: demoPresets[id],
            };
          }, id);
          const spec = result.presets.find((x) => x.name === name);
          for (const [k, v] of Object.entries(spec.values)) {
            assert.deepEqual(
              result.values[k] ??
                (Array.isArray(result.definitions[k])
                  ? result.definitions[k][0]
                  : result.definitions[k]),
              v,
              id + ' ' + name + ' ' + k,
            );
          }
          await versions.press('Enter');
        }
        await p
          .getByRole('menuitemradio', { name: 'Version 1', exact: true })
          .press('Enter');
        await p.waitForFunction(
          async (id) =>
            Object.keys(
              (await import('/app/lib/demo-tuning.ts')).demoTuning(id).values,
            ).length === 0,
          id,
        );
        assert.deepEqual(errors, [], id);
        console.log(id, 'OK');
        await p.close();
      }),
    );
  }
} finally {
  await b.close();
}
