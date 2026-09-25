import QUnit from 'qunit';
const { module, test } = QUnit;
import { readdirSync, readFileSync } from 'fs';
import { basename, join, relative } from 'path';
import { fileURLToPath } from 'url';
import type { Realm } from '@cardstack/runtime-common';
import { rri } from '@cardstack/runtime-common';
import type { RealmHttpServer as Server } from '../server.ts';
import { closeServer, setupPermissionedRealmCached } from './helpers/index.ts';
import {
  catalogTestSubsetManifest,
  servedCatalogSubsetFile,
  setupCatalogTestSubset,
} from './helpers/catalog-test-subset.ts';

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..', '..');

// A card in a test realm adopting from a definition in the catalog test
// subset, reached through `@cardstack/catalog/` as it is in a deployment.
module(basename(import.meta.filename), function (hooks) {
  let testRealm: Realm;
  let testRealmHttpServer: Server;

  setupCatalogTestSubset(hooks);

  hooks.afterEach(async function () {
    await closeServer(testRealmHttpServer);
  });

  setupPermissionedRealmCached(hooks, {
    fixture: 'blank',
    permissions: { '*': ['read'] },
    onRealmSetup({ testRealm: realm, testRealmHttpServer: server }) {
      testRealm = realm;
      testRealmHttpServer = server;
    },
  });

  test('an instance of a catalog test subset definition indexes', async function (assert) {
    await testRealm.write(
      'policies/education.json',
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {
            cardInfo: { name: 'Education' },
            rules: [
              {
                targetType: { module: '../classroom', name: 'Classroom' },
                grants: [
                  { operation: 'read' },
                  {
                    operation: 'appendActivity',
                    where: { bxl: 'actor() in .teacherIds', snapshot: true },
                  },
                ],
              },
            ],
          },
          meta: {
            adoptsFrom: {
              module: rri('@cardstack/catalog/realm-policy/realm-policy'),
              name: 'RealmPolicy',
            },
          },
        },
      }),
    );

    let doc = await testRealm.realmIndexQueryEngine.cardDocument(
      new URL(`${testRealm.url}policies/education`),
    );
    assert.strictEqual(
      doc?.type,
      'doc',
      `the instance indexes cleanly: ${JSON.stringify(
        doc?.type === 'error' ? doc.error : undefined,
      )}`,
    );
    let rules = (doc?.type === 'doc' ? doc.doc.data.attributes?.rules : []) as {
      grants: { operation: string; where: unknown }[];
    }[];
    assert.deepEqual(
      rules[0]?.grants,
      [
        { operation: 'read', where: null },
        {
          operation: 'appendActivity',
          where: { bxl: 'actor() in .teacherIds', snapshot: true },
        },
      ],
      "the catalog definition's fields, including its serializer-backed predicate, round-trip",
    );
  });
});

// The catalog's copy of a subset definition is the only one. A second copy in
// this repo, whether a base module, a test-realm card or a fixture string,
// would drift from the one deployments serve while the tests kept passing
// against it.
module(`${basename(import.meta.filename)} | one copy`, function (hooks) {
  setupCatalogTestSubset(hooks);

  // Source files under packages/, leaving out the catalog package (whose
  // test-subset/ and contents/ hold the catalog's own copy) and anything
  // generated or installed.
  function sourceFiles(dir: string): string[] {
    let files: string[] = [];
    for (let entry of readdirSync(dir, { withFileTypes: true })) {
      let path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (
          entry.name.startsWith('.') ||
          ['node_modules', 'dist', 'declarations', 'tmp'].includes(
            entry.name,
          ) ||
          path === join(REPO_ROOT, 'packages', 'catalog')
        ) {
          continue;
        }
        files.push(...sourceFiles(path));
      } else if (/\.g?ts$/.test(entry.name)) {
        files.push(path);
      }
    }
    return files;
  }

  test('no class a subset definition exports is declared anywhere else in this repo', async function (assert) {
    let names = new Set<string>();
    for (let { path } of catalogTestSubsetManifest().files) {
      let source = await servedCatalogSubsetFile(path);
      for (let [, name] of source.matchAll(
        /^export\s+(?:default\s+)?class\s+(\w+)/gm,
      )) {
        names.add(name);
      }
    }
    assert.true(
      names.size > 0,
      `the classes to look for were read from the served subset: ${[...names].join(', ')}`,
    );

    let declaration = new RegExp(`\\bclass\\s+(${[...names].join('|')})\\b`);
    let copies: string[] = [];
    for (let file of sourceFiles(join(REPO_ROOT, 'packages'))) {
      let match = readFileSync(file, 'utf8').match(declaration);
      if (match) {
        copies.push(`${relative(REPO_ROOT, file)} declares ${match[1]}`);
      }
    }
    assert.deepEqual(
      copies,
      [],
      'a definition in packages/catalog/test-subset.json lives only in boxel-catalog; change it there (see .claude/skills/catalog-test-subset) rather than declaring it in this repo',
    );
  });
});
