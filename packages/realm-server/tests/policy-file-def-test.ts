import QUnit from 'qunit';
const { module, test } = QUnit;
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  POLICY_FILE_DEF_CODE_REF_BY_EXTENSION,
  baseFileRef,
  baseRRI,
  policyFileDefCodeRef,
} from '@cardstack/runtime-common';

const BASE_PATH = join(import.meta.dirname, '..', '..', 'base');

function baseRef(module: string, name: string) {
  return { module: baseRRI(module), name };
}

// The `FileDef` subclasses base exports, read from its top-level `.gts`
// sources: `export class X extends Y` for every class whose ancestry reaches
// `FileDef` in `card-api.gts`. Read as source because the definitions are
// Glimmer modules that do not load outside a realm.
function baseFileDefSubclasses(): Map<
  string,
  { module: string; parent: string }
> {
  let declaration = /^export (?:default )?class (\w+) extends (\w+)\b/gm;
  let classes = new Map<string, { module: string; parent: string }>();
  for (let file of readdirSync(BASE_PATH)) {
    if (!file.endsWith('.gts')) {
      continue;
    }
    let source = readFileSync(join(BASE_PATH, file), 'utf8');
    for (let [, name, parent] of source.matchAll(declaration)) {
      classes.set(name, { module: file.replace(/\.gts$/, ''), parent });
    }
  }
  let isFileDef = (name: string): boolean => {
    for (let seen = new Set<string>(); !seen.has(name); ) {
      seen.add(name);
      if (name === 'FileDef') {
        return true;
      }
      let entry = classes.get(name);
      if (!entry) {
        return false;
      }
      name = entry.parent;
    }
    return false;
  };
  return new Map(
    [...classes].filter(([name]) => name !== 'FileDef' && isFileDef(name)),
  );
}

module(basename(import.meta.filename), function () {
  module('policyFileDefCodeRef', function () {
    test('resolves a data file to the FileDef subclass it is indexed as', function (assert) {
      assert.deepEqual(
        policyFileDefCodeRef('photos/cat.png'),
        baseRef('png-image-def', 'PngDef'),
        '.png',
      );
      assert.deepEqual(
        policyFileDefCodeRef('report.pdf'),
        baseRef('pdf-file-def', 'PdfDef'),
        '.pdf',
      );
      assert.deepEqual(
        policyFileDefCodeRef('notes/README.md'),
        baseRef('markdown-file-def', 'MarkdownDef'),
        '.md',
      );
      assert.deepEqual(
        policyFileDefCodeRef('data/sales.csv'),
        baseRef('csv-file-def', 'CsvFileDef'),
        '.csv',
      );
    });

    test('matches the extension case-insensitively', function (assert) {
      assert.deepEqual(
        policyFileDefCodeRef('Photo.PNG'),
        baseRef('png-image-def', 'PngDef'),
      );
    });

    test('resolves an unmapped extension, or none, to FileDef', function (assert) {
      assert.deepEqual(policyFileDefCodeRef('blob.xyz'), baseFileRef, '.xyz');
      assert.deepEqual(policyFileDefCodeRef('LICENSE'), baseFileRef, 'none');
      assert.deepEqual(
        policyFileDefCodeRef('.gitignore'),
        baseFileRef,
        'dotfile',
      );
      assert.deepEqual(
        policyFileDefCodeRef('v1.2/LICENSE'),
        baseFileRef,
        'a dot in a directory is not an extension',
      );
    });

    test('resolves module source to nothing, which is not FileDef', function (assert) {
      for (let filename of [
        'person.gts',
        'util.ts',
        'legacy.js',
        'component.gjs',
        'Person.GTS',
      ]) {
        assert.strictEqual(policyFileDefCodeRef(filename), undefined, filename);
      }
    });
  });

  module('POLICY_FILE_DEF_CODE_REF_BY_EXTENSION', function () {
    test('carries no module-source extension', function (assert) {
      for (let extension of ['.js', '.gjs', '.ts', '.gts']) {
        assert.false(
          extension in POLICY_FILE_DEF_CODE_REF_BY_EXTENSION,
          extension,
        );
      }
    });

    test('every mapping names a FileDef subclass base exports from that module', function (assert) {
      let subclasses = baseFileDefSubclasses();
      for (let [extension, ref] of Object.entries(
        POLICY_FILE_DEF_CODE_REF_BY_EXTENSION,
      )) {
        let entry = subclasses.get(ref.name);
        assert.deepEqual(
          entry ? baseRef(entry.module, ref.name) : undefined,
          ref,
          `${extension} → ${ref.name}`,
        );
      }
    });

    test('every FileDef subclass base exports is reachable from an extension', function (assert) {
      let subclasses = baseFileDefSubclasses();
      // Module source is never grantable, so its defs are deliberately
      // unreachable from this table.
      let moduleSourceDefs = new Set(['TsFileDef', 'GtsFileDef']);
      let reachable = new Set<string>();
      for (let { name } of Object.values(
        POLICY_FILE_DEF_CODE_REF_BY_EXTENSION,
      )) {
        // A rule naming an ancestor matches a mapped def, so the whole chain
        // up to FileDef is reachable.
        for (let current: string | undefined = name; current; ) {
          reachable.add(current);
          current = subclasses.get(current)?.parent;
        }
      }
      assert.ok(
        subclasses.size > 0,
        'found FileDef subclasses in base (the source scan ran)',
      );
      assert.true(
        subclasses.has('ImageDef'),
        'ImageDef, declared in card-api, is part of the scan',
      );
      assert.deepEqual(
        [...subclasses.keys()]
          .filter((name) => !moduleSourceDefs.has(name) && !reachable.has(name))
          .sort(),
        [],
        'no FileDef subclass is left without an extension',
      );
      for (let name of moduleSourceDefs) {
        assert.true(subclasses.has(name), `${name} exists in base`);
        assert.false(reachable.has(name), `${name} is not reachable`);
      }
    });
  });
});
