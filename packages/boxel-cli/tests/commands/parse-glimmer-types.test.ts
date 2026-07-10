import * as fs from 'fs';
import * as os from 'os';
import { join, resolve } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { parseRealm } from '../../src/commands/parse.ts';

// `boxel parse` resolves third-party imports in card code against
// boxel-cli's own node_modules when running from the published layout
// (bundled-types present). Cards that define plain Glimmer components
// import `@glimmer/component` / `@glimmer/tracking`, so those packages
// must be runtime dependencies of boxel-cli (CS-11509).
//
// This exercises the published-layout resolution path: CI runs
// `pnpm build` (which produces `bundled-types/`) before the unit
// tests. Without that build, parse falls back to the monorepo layout
// and resolves against host's node_modules — which would mask a
// missing boxel-cli dependency — so the test skips instead.
const bundledTypesPresent = fs.existsSync(
  resolve(__dirname, '../../bundled-types/base'),
);

describe.skipIf(!bundledTypesPresent)(
  'boxel parse — @glimmer imports in card code',
  () => {
    let workspace: string;

    beforeAll(() => {
      workspace = fs.mkdtempSync(join(os.tmpdir(), 'boxel-parse-glimmer-'));
      fs.writeFileSync(
        join(workspace, 'counter.gts'),
        `import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import {
  CardDef,
  Component as CardComponent,
  field,
  contains,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';

class CounterWidget extends Component<{ Args: { start?: number } }> {
  @tracked count = this.args.start ?? 0;
  <template><span>{{this.count}}</span></template>
}

export class Counter extends CardDef {
  static displayName = 'Counter';
  @field start = contains(NumberField);
  static isolated = class Isolated extends CardComponent<typeof Counter> {
    <template><CounterWidget @start={{@model.start}} /></template>
  };
}
`,
      );
    });

    afterAll(() => {
      fs.rmSync(workspace, { recursive: true, force: true });
    });

    it(
      'type-checks a card defining a plain Glimmer component',
      async () => {
        let result = await parseRealm(undefined, { workspace });
        expect(result.errors).toEqual([]);
        expect(result.status).toBe('passed');
        expect(result.filesChecked).toBeGreaterThanOrEqual(1);
      },
      { timeout: 180_000 },
    );
  },
);
