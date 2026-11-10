// Run with: pnpm --dir packages/catalog test:lint-identity

import { strict as assert } from 'node:assert';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, before, test } from 'node:test';

import {
  compilerOptionsFrom,
  findUnmarkedDefinitions,
  moduleFiles,
  type UnmarkedDefinition,
} from './identity.ts';

const catalogDir = resolve(import.meta.dirname, '..');

// Each fixture is a realm of its own, checked with the catalog's compiler
// options, so `@cardstack/base/*` is the real base realm.
const fixtures: Record<string, string> = {
  'factory.ts': `
    import { FieldDef } from '@cardstack/base/card-api';
    export function tierField(options: string[]) {
      return class TierField extends FieldDef {
        static options = options;
      };
    }
    export function notADefinition(n: number) {
      return [n];
    }
    export function untyped(): any {
      return FieldDef;
    }
  `,
  'unmarked.gts': `
    import { CardDef, Component } from '@cardstack/base/card-api';
    import StringField from '@cardstack/base/string';
    import enumField from '@cardstack/base/enum';
    import { tierField, notADefinition, untyped } from './factory';

    export class Holder extends CardDef {
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <p>one</p>
          <p>two</p>
          <p>three</p>
        </template>
      };
    }

    export const StatusField = enumField(StringField, { options: ['a', 'b'] });
    export const TierField = tierField(['gold']);
    const Renamed = enumField(StringField, { options: ['c'] });
    export { Renamed as RenamedField };
    export const Asserted = (tierField(['g']) as ReturnType<typeof tierField>);
    export const Satisfied = tierField(['h']) satisfies ReturnType<typeof tierField>;
    export const NonNull = tierField(['i'])!;
    export const MultiLine = tierField
      (['j']);
    export const NOT_A_DEFINITION = notADefinition(1);
    export const Untyped = untyped();
    const Unexported = enumField(StringField, { options: ['d'] });
    export class UsesUnexported extends CardDef {
      static displayName = String(Unexported.name);
    }
  `,
  'default-export.ts': `
    import StringField from '@cardstack/base/string';
    import enumField from '@cardstack/base/enum';
    export default enumField(StringField, { options: ['x'] });
  `,
  'marked.ts': `
    import StringField from '@cardstack/base/string';
    import enumField from '@cardstack/base/enum';
    import { markDefinition } from '@cardstack/base/mark-definition';
    import { markDefinition as mark } from '@cardstack/base/mark-definition';
    import * as md from '@cardstack/base/mark-definition';
    import { tierField } from './factory';
    export const A = markDefinition(enumField(StringField, { options: ['a'] }));
    export const B = mark(tierField(['b']));
    export const C = md.markDefinition(tierField(['c']));
    export const D = (markDefinition(tierField(['d'])) as ReturnType<typeof tierField>);
    const E = markDefinition(tierField(['e']));
    export { E };
    export default markDefinition(tierField(['f']));
  `,
  'misspelled.ts': `
    import { markDefinition } from 'https://cardstack.com/base/mark-definition';
    import { tierField } from './factory';
    export const Misspelled = markDefinition(tierField(['k']));
  `,
  'nested/imports-gts.ts': `
    import { StatusField } from '../unmarked.gts';
    import { TierField } from '../unmarked';
    export const Reexported = StatusField;
    export const AlsoTier = TierField;
  `,
};

let dir: string;
let found: UnmarkedDefinition[];

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'lint-identity-'));
  for (let [name, source] of Object.entries(fixtures)) {
    let path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, source.replace(/^\n/, ''));
  }
  found = findUnmarkedDefinitions({
    files: moduleFiles(dir),
    compilerOptions: compilerOptionsFrom(join(catalogDir, 'tsconfig.json')),
  });
});

after(() => {
  rmSync(dir, { recursive: true, force: true });
});

function reported(file: string) {
  return found
    .filter((d) => d.file === join(dir, file))
    .map((d) => d.exportedName)
    .sort();
}

test('reports an exported definition made by a base factory or a realm factory', () => {
  assert.deepEqual(reported('unmarked.gts'), [
    'Asserted',
    'MultiLine',
    'NonNull',
    'RenamedField',
    'Satisfied',
    'StatusField',
    'TierField',
  ]);
});

test('reports a default export made by a call', () => {
  assert.deepEqual(reported('default-export.ts'), ['default']);
});

test('leaves alone a call that returns no definition, an untyped one, and an unexported definition', () => {
  let names = found.map((d) => d.exportedName);
  for (let name of ['NOT_A_DEFINITION', 'Untyped', 'Unexported']) {
    assert.ok(!names.includes(name), `${name} was reported`);
  }
});

test('accepts every form of the wrap the compiler recognizes', () => {
  assert.deepEqual(reported('marked.ts'), []);
});

test('reports an import of markDefinition by another spelling of base, not the call it wraps', () => {
  let reports = found.filter((d) => d.file === join(dir, 'misspelled.ts'));
  assert.equal(reports.length, 1);
  assert.equal(reports[0].exportedName, undefined);
  assert.equal(reports[0].line, 1);
  assert.match(
    reports[0].message,
    /^import markDefinition from '@cardstack\/base\/mark-definition', not 'https:\/\/cardstack\.com\/base\/mark-definition'/,
  );
});

test('keeps a report on one line when the callee spans lines', () => {
  let multiLine = found.find((d) => d.exportedName === 'MultiLine')!;
  assert.ok(!multiLine.message.includes('\n'));
  assert.match(multiLine.message, /markDefinition\(tierField\(\.\.\.\)\)/);
});

// Imports one .gts module by both of the names TypeScript looks for it under,
// with and without the extension, and checks that neither stops the check.
// Whether the two names resolve to one module is pinned by the realm-factory
// test above, which fails when they don't, through base's own .gts modules.
test('leaves alone an exported binding that only aliases a definition', () => {
  assert.deepEqual(reported('nested/imports-gts.ts'), []);
});

test('reports a position in the .gts source, below a template', () => {
  let status = found.find((d) => d.exportedName === 'StatusField')!;
  let source = fixtures['unmarked.gts'].replace(/^\n/, '').split('\n');
  assert.equal(
    source[status.line - 1].slice(status.column - 1, status.column - 1 + 9),
    'enumField',
  );
});

test('names the wrap at the declaration of a binding exported by name', () => {
  let renamed = found.find((d) => d.exportedName === 'RenamedField')!;
  assert.match(
    renamed.message,
    /const Renamed = markDefinition\(enumField\(\.\.\.\)\)/,
  );
});

test('names the wrap the definition needs', () => {
  let tier = found.find((d) => d.exportedName === 'TierField')!;
  assert.match(
    tier.message,
    /export const TierField = markDefinition\(tierField\(\.\.\.\)\)/,
  );
  assert.match(tier.message, /'@cardstack\/base\/mark-definition'/);
});
