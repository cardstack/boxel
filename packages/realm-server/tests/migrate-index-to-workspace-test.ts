import QUnit from 'qunit';
const { module, test } = QUnit;

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'fs';
import { tmpdir } from 'os';
import { basename, join } from 'path';

import {
  classify,
  discoverPublishedRealms,
  discoverUserRealms,
  extraKeys,
  forcedTarget,
  main,
  rewriteIndexJson,
  splitBaseModule,
} from '../scripts/migrate-index-to-workspace.ts';

// Unit coverage for the realm index-card migration
// (`scripts/migrate-index-to-workspace.ts`), which switches a realm's
// `index.json` from the legacy default index — `CardsGrid`, or its `IndexCard`
// alias — to `Workspace`. The costly mistakes it has to avoid are rewriting a
// realm that customized its index, and losing data the file carries alongside
// the adoption, so both get direct tests.

function indexCard(module: string, name: string, extra: object = {}) {
  return JSON.stringify({
    data: { type: 'card', meta: { adoptsFrom: { module, name } }, ...extra },
  });
}

function withTempDir(fn: (dir: string) => void) {
  let dir = mkdtempSync(join(tmpdir(), 'migrate-index-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeRealm(root: string, path: string, contents: string) {
  let dir = join(root, path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.json'), contents);
  return dir;
}

function captureLogs(fn: () => number): { code: number; out: string } {
  let out: string[] = [];
  let log = console.log;
  let error = console.error;
  console.log = (...args: unknown[]) => out.push(args.join(' '));
  console.error = (...args: unknown[]) => out.push(args.join(' '));
  try {
    return { code: fn(), out: out.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
}

// The outermost module must be the file's basename: CI shards this suite by
// setting TEST_MODULES, which becomes a QUnit filter anchored on each file's
// own name. A module named anything else matches nothing and the whole file is
// silently skipped in CI while still passing locally.
module(basename(import.meta.filename), function () {
  module('splitBaseModule', function () {
    test('recognizes the prefix form and every deployment-URL spelling', function (assert) {
      assert.deepEqual(splitBaseModule('@cardstack/base/cards-grid'), {
        prefix: '@cardstack/base/',
        segment: 'cards-grid',
      });
      assert.deepEqual(
        splitBaseModule('https://cardstack.com/base/cards-grid'),
        { prefix: 'https://cardstack.com/base/', segment: 'cards-grid' },
      );
      assert.deepEqual(
        splitBaseModule('https://realms-staging.stack.cards/base/index'),
        {
          prefix: 'https://realms-staging.stack.cards/base/',
          segment: 'index',
        },
      );
    });

    test('a module outside the base realm is not a base module', function (assert) {
      assert.strictEqual(
        splitBaseModule('@cardstack/catalog/cards-grid'),
        undefined,
        'another realm prefix',
      );
      assert.strictEqual(
        splitBaseModule('https://example.com/mine/cards-grid'),
        undefined,
        'a URL with no /base/ segment',
      );
      assert.strictEqual(
        splitBaseModule('./cards-grid'),
        undefined,
        'relative',
      );
    });
  });

  module('classify', function () {
    test('CardsGrid is legacy in both module forms, and keeps the form it had', function (assert) {
      let prefix = classify({
        module: '@cardstack/base/cards-grid',
        name: 'CardsGrid',
      });
      assert.strictEqual(prefix.kind, 'legacy');
      assert.deepEqual(prefix.kind === 'legacy' ? prefix.target : undefined, {
        module: '@cardstack/base/workspace',
        name: 'Workspace',
      });

      let url = classify({
        module: 'https://cardstack.com/base/cards-grid',
        name: 'CardsGrid',
      });
      assert.strictEqual(url.kind, 'legacy');
      assert.deepEqual(url.kind === 'legacy' ? url.target : undefined, {
        module: 'https://cardstack.com/base/workspace',
        name: 'Workspace',
      });
    });

    test('IndexCard is legacy too — base/index re-exports CardsGrid under that name', function (assert) {
      let result = classify({
        module: 'https://cardstack.com/base/index',
        name: 'IndexCard',
      });
      assert.strictEqual(result.kind, 'legacy');
      assert.deepEqual(result.kind === 'legacy' ? result.target : undefined, {
        module: 'https://cardstack.com/base/workspace',
        name: 'Workspace',
      });
    });

    test('an already-migrated realm is left alone', function (assert) {
      assert.strictEqual(
        classify({ module: '@cardstack/base/workspace', name: 'Workspace' })
          .kind,
        'workspace',
      );
    });

    test('a bespoke index card is not migrated', function (assert) {
      assert.strictEqual(
        classify({
          module: './boxel-ai-website/boxel-home-layout',
          name: 'HomeLayoutCard',
        }).kind,
        'relative',
        'a realm-local module is reported separately, never rewritten',
      );
      assert.strictEqual(
        classify({ module: '@cardstack/catalog/blog', name: 'Blog' }).kind,
        'bespoke',
      );
    });

    test('a base-realm export that is not an index card is bespoke', function (assert) {
      assert.strictEqual(
        classify({ module: '@cardstack/base/cards-grid', name: 'Renderer' })
          .kind,
        'bespoke',
        'right module, wrong export name',
      );
      assert.strictEqual(
        classify({ module: '@cardstack/base/skill', name: 'Skill' }).kind,
        'bespoke',
      );
    });

    test('a file with no usable adoption is reported, not guessed at', function (assert) {
      assert.strictEqual(classify(undefined).kind, 'unusable');
      assert.strictEqual(classify({ module: 'x' }).kind, 'unusable');
    });
  });

  module('rewriteIndexJson', function () {
    test('only the adoption changes; attributes and relationships survive', function (assert) {
      let source = indexCard('https://cardstack.com/base/index', 'IndexCard', {
        attributes: { title: 'My Realm' },
        relationships: { cardsGrid: { links: { self: './cards-grid' } } },
      });
      let result = JSON.parse(
        rewriteIndexJson(source, {
          module: 'https://cardstack.com/base/workspace',
          name: 'Workspace',
        }),
      );
      assert.deepEqual(result.data.meta.adoptsFrom, {
        module: 'https://cardstack.com/base/workspace',
        name: 'Workspace',
      });
      assert.deepEqual(result.data.attributes, { title: 'My Realm' });
      assert.deepEqual(result.data.relationships, {
        cardsGrid: { links: { self: './cards-grid' } },
      });
    });

    test('the file keeps whichever formatting it already used', function (assert) {
      let compact = indexCard('@cardstack/base/cards-grid', 'CardsGrid');
      let rewrittenCompact = rewriteIndexJson(compact, forcedTarget());
      assert.notOk(
        rewrittenCompact.includes('\n'),
        'a single-line file stays a single line',
      );

      let rewrittenTerminated = rewriteIndexJson(
        `${compact}\n`,
        forcedTarget(),
      );
      assert.false(
        rewrittenTerminated.trimEnd().includes('\n'),
        'a single line plus a trailing newline — what the realm server writes — is not reflowed',
      );
      assert.ok(rewrittenTerminated.endsWith('\n'), 'and keeps its newline');

      let pretty = `${JSON.stringify(JSON.parse(compact), null, 2)}\n`;
      let rewrittenPretty = rewriteIndexJson(pretty, forcedTarget());
      assert.ok(
        rewrittenPretty.includes('\n  "data"'),
        'a pretty-printed file stays pretty-printed',
      );
      assert.ok(
        rewrittenPretty.endsWith('\n'),
        'a trailing newline is preserved',
      );
    });
  });

  test('extraKeys names what a file carries beyond the adoption', function (assert) {
    assert.deepEqual(
      extraKeys(indexCard('@cardstack/base/cards-grid', 'CardsGrid')),
      [],
      'a plain index card carries nothing',
    );
    assert.deepEqual(
      extraKeys(
        indexCard('@cardstack/base/cards-grid', 'CardsGrid', {
          attributes: { title: 'x' },
          relationships: {},
        }),
      ),
      ['data.attributes', 'data.relationships'],
    );
  });

  test('discoverUserRealms walks exactly two levels, and skips _published', function (assert) {
    withTempDir((dir) => {
      makeRealm(dir, 'buck/mar10', '{}');
      makeRealm(dir, 'buck/other', '{}');
      makeRealm(dir, 'tintin/notes', '{}');
      // A card living inside a realm must not be mistaken for a realm.
      mkdirSync(join(dir, 'buck/mar10/Author'), { recursive: true });
      // _published is a flat <disk-id> tree, not an owner.
      makeRealm(dir, '_published/e3271e35', '{}');

      assert.deepEqual(discoverUserRealms(dir), [
        join(dir, 'buck', 'mar10'),
        join(dir, 'buck', 'other'),
        join(dir, 'tintin', 'notes'),
      ]);
    });
  });

  test('discoverPublishedRealms walks the flat snapshot tree', function (assert) {
    withTempDir((dir) => {
      makeRealm(dir, 'buck/mar10', '{}');
      makeRealm(dir, '_published/e3271e35', '{}');
      makeRealm(dir, '_published/9b0c1d2e', '{}');

      assert.deepEqual(discoverPublishedRealms(dir), [
        join(dir, '_published', '9b0c1d2e'),
        join(dir, '_published', 'e3271e35'),
      ]);
    });
  });

  test('publish snapshots are migrated only when --published asks for them', function (assert) {
    withTempDir((dir) => {
      let snapshot = makeRealm(
        dir,
        '_published/e3271e35',
        indexCard('@cardstack/base/cards-grid', 'CardsGrid'),
      );
      let before = readFileSync(join(snapshot, 'index.json'), 'utf8');

      captureLogs(() =>
        main(['--realms-root', dir, '--manifest', join(dir, 'm1.json')]),
      );
      assert.strictEqual(
        readFileSync(join(snapshot, 'index.json'), 'utf8'),
        before,
        'skipped by default — a republish regenerates it from its source realm',
      );

      captureLogs(() =>
        main([
          '--realms-root',
          dir,
          '--published',
          '--manifest',
          join(dir, 'm2.json'),
        ]),
      );
      assert.deepEqual(
        JSON.parse(readFileSync(join(snapshot, 'index.json'), 'utf8')).data.meta
          .adoptsFrom,
        { module: '@cardstack/base/workspace', name: 'Workspace' },
        'migrated when explicitly asked for',
      );
    });
  });

  module('main', function () {
    test('a dry run reports the plan and writes nothing', function (assert) {
      withTempDir((dir) => {
        let realm = makeRealm(
          dir,
          'buck/mar10',
          indexCard('@cardstack/base/cards-grid', 'CardsGrid'),
        );
        let before = readFileSync(join(realm, 'index.json'), 'utf8');

        let { code, out } = captureLogs(() =>
          main(['--dry-run', '--realms-root', dir]),
        );

        assert.strictEqual(code, 0);
        assert.ok(out.includes('Dry run over 1 realm'), out);
        assert.strictEqual(
          readFileSync(join(realm, 'index.json'), 'utf8'),
          before,
          'the file on disk is untouched',
        );
      });
    });

    test('an applied run migrates only the legacy realms and can be rolled back', function (assert) {
      withTempDir((dir) => {
        let legacy = makeRealm(
          dir,
          'buck/mar10',
          indexCard('https://cardstack.com/base/cards-grid', 'CardsGrid'),
        );
        let alias = makeRealm(
          dir,
          'buck/notes',
          indexCard('@cardstack/base/index', 'IndexCard'),
        );
        let bespoke = makeRealm(
          dir,
          'tintin/site',
          indexCard('@cardstack/catalog/blog', 'Blog'),
        );
        let done = makeRealm(
          dir,
          'tintin/already',
          indexCard('@cardstack/base/workspace', 'Workspace'),
        );
        let bespokeBefore = readFileSync(join(bespoke, 'index.json'), 'utf8');
        let manifest = join(dir, 'manifest.json');

        let { code } = captureLogs(() =>
          main(['--realms-root', dir, '--manifest', manifest]),
        );
        assert.strictEqual(code, 0);

        let adoption = (realm: string) =>
          JSON.parse(readFileSync(join(realm, 'index.json'), 'utf8')).data.meta
            .adoptsFrom;
        assert.deepEqual(
          adoption(legacy),
          {
            module: 'https://cardstack.com/base/workspace',
            name: 'Workspace',
          },
          'CardsGrid migrated, absolute form preserved',
        );
        assert.deepEqual(
          adoption(alias),
          { module: '@cardstack/base/workspace', name: 'Workspace' },
          'IndexCard migrated, prefix form preserved',
        );
        assert.strictEqual(
          readFileSync(join(bespoke, 'index.json'), 'utf8'),
          bespokeBefore,
          'the customized realm is untouched',
        );
        assert.deepEqual(
          adoption(done),
          { module: '@cardstack/base/workspace', name: 'Workspace' },
          'the already-migrated realm is unchanged',
        );

        let restored = captureLogs(() => main(['--rollback', manifest]));
        assert.strictEqual(restored.code, 0);
        assert.deepEqual(
          adoption(legacy),
          {
            module: 'https://cardstack.com/base/cards-grid',
            name: 'CardsGrid',
          },
          'rollback restores the original adoption',
        );
      });
    });

    test('the report gives each migrated realm as a reindex realm= path', function (assert) {
      withTempDir((dir) => {
        makeRealm(
          dir,
          'buck/mar10',
          indexCard('@cardstack/base/cards-grid', 'CardsGrid'),
        );
        // Three levels deep, so the two-level owner walk does not reach it and
        // it is only in scope as an explicit argument.
        let explicit = makeRealm(
          dir,
          'deep/deeper/deepest/thing',
          indexCard('@cardstack/base/cards-grid', 'CardsGrid'),
        );

        let { out } = captureLogs(() =>
          main(['--dry-run', '--realms-root', dir, explicit]),
        );

        let realmList = out.slice(out.indexOf('As a realm= list'));
        assert.ok(
          realmList.includes(join('buck', 'mar10')),
          'a realm found under a realms root is listed as <user>/<realm>',
        );
        assert.notOk(
          realmList.includes('thing'),
          'an explicitly named directory is omitted — its disk path implies no URL',
        );
      });
    });

    test('--include migrates a realm whose index is a hand-rolled workspace', function (assert) {
      withTempDir((dir) => {
        let handRolled = makeRealm(
          dir,
          'ctse/demo',
          indexCard('./workspace', 'Workspace'),
        );
        let otherBespoke = makeRealm(
          dir,
          'ctse/other',
          indexCard('./workspace', 'Workspace'),
        );

        let { code } = captureLogs(() =>
          main([
            '--realms-root',
            dir,
            '--include',
            'ctse/demo',
            '--manifest',
            join(dir, 'manifest.json'),
          ]),
        );
        assert.strictEqual(code, 0);

        assert.deepEqual(
          JSON.parse(readFileSync(join(handRolled, 'index.json'), 'utf8')).data
            .meta.adoptsFrom,
          { module: '@cardstack/base/workspace', name: 'Workspace' },
          'the named realm moves to the base Workspace',
        );
        assert.deepEqual(
          JSON.parse(readFileSync(join(otherBespoke, 'index.json'), 'utf8'))
            .data.meta.adoptsFrom,
          { module: './workspace', name: 'Workspace' },
          'an identical realm that was not named is left alone',
        );
      });
    });

    test('an --include that matches no scanned realm fails the run', function (assert) {
      withTempDir((dir) => {
        makeRealm(
          dir,
          'buck/mar10',
          indexCard('@cardstack/base/cards-grid', 'CardsGrid'),
        );
        let { code, out } = captureLogs(() =>
          main([
            '--dry-run',
            '--realms-root',
            dir,
            '--include',
            'nobody/nothing',
          ]),
        );
        assert.strictEqual(code, 1, 'a typo in --include is not silent');
        assert.ok(out.includes('nobody/nothing'), out);
      });
    });

    test('a realm with unreadable or missing index JSON is reported, not rewritten', function (assert) {
      withTempDir((dir) => {
        makeRealm(dir, 'buck/broken', '{ not json');
        mkdirSync(join(dir, 'buck/empty'), { recursive: true });

        let { code, out } = captureLogs(() =>
          main(['--dry-run', '--realms-root', dir]),
        );
        assert.strictEqual(code, 0);
        assert.ok(out.includes('invalid JSON'), out);
        assert.ok(out.includes('no index.json'), out);
        assert.notOk(out.includes('* '), 'nothing is marked for migration');
      });
    });
  });
});
