import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import type { Readable } from 'stream';
import type { PgAdapter } from '@cardstack/postgres';
import {
  abandonAutomationRun,
  cancelAutomationRun,
  finishAutomationRun,
  rri,
  startAutomationRunAttempt,
  SupportedMimeType,
} from '@cardstack/runtime-common';
import {
  RUN_COMMIT_PATH,
  stageRunOverlayFile,
} from '@cardstack/runtime-common/run-overlay';
import type { Realm } from '@cardstack/runtime-common';
import {
  createAutomationRunToken,
  createJWT,
  realmSecretSeed,
  setupPermissionedRealmCached,
} from './helpers/index.ts';
import { mintRunToken } from '../lib/run-token.ts';
import { nodeStreamToBuffer } from '../stream.ts';

// ============================================================================
// The run overlay: a run's writes are staged on the realm server, not written
// to the realm, and the run's own reads read through them. Nobody else sees a
// staged file. The run's `writes` cap bounds how many files it stages, a
// retry that takes the run over starts from an empty overlay, and every way a
// run ends discards its overlay.
// ============================================================================

const realmURL = new URL('http://127.0.0.1:4444/run-overlay-test/');
const OWNER = '@owner:localhost';
const SOURCE = 'application/vnd.card+source';

module(basename(import.meta.filename), function (hooks) {
  let realm: Realm;
  let dbAdapter: PgAdapter;

  setupPermissionedRealmCached(hooks, {
    realmURL,
    permissions: {
      [OWNER]: ['read', 'write'],
      '@node-test_realm:localhost': ['read', 'realm-owner'],
    },
    fileSystem: {
      'notes.txt': 'in the realm',
      'logs/2026-11.jsonl': '{"n":1}\n',
      'thing.gts': `import { CardDef } from 'https://cardstack.com/base/card-api';
export class Thing extends CardDef {}`,
      'person.gts': `import { CardDef, field, contains, containsMany } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
export class Person extends CardDef {
  @field name = contains(StringField);
  @field nicknames = containsMany(StringField);
}`,
      'people/ada.json': {
        data: {
          type: 'card',
          attributes: { name: 'Ada', nicknames: [] },
          meta: { adoptsFrom: { module: rri('../person'), name: 'Person' } },
        },
      },
    },
    onRealmSetup(args) {
      realm = args.testRealm;
      dbAdapter = args.dbAdapter;
    },
  });

  function session() {
    return createJWT(realm, OWNER, ['read', 'write']);
  }

  async function body(response: Response & { nodeStream?: Readable }) {
    return response.nodeStream
      ? new Uint8Array(await nodeStreamToBuffer(response.nodeStream))
      : new Uint8Array(await response.arrayBuffer());
  }

  async function readText(token: string, path: string) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${path}`, {
        headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
      }),
    ))!;
    return {
      status: response.status,
      text:
        response.status === 200
          ? new TextDecoder().decode(await body(response))
          : undefined,
    };
  }

  async function writeText(token: string, path: string, content: string) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${path}`, {
        method: 'POST',
        headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
        body: content,
      }),
    ))!;
    return { status: response.status, text: await response.text() };
  }

  async function writeBytes(
    token: string,
    path: string,
    bytes: Uint8Array<ArrayBuffer>,
  ) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          Authorization: `Bearer ${token}`,
        },
        body: bytes,
      }),
    ))!;
    return response.status;
  }

  async function list(token: string, dir = '') {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${dir}`, {
        headers: {
          Accept: 'application/vnd.api+json; boxel=directory',
          Authorization: `Bearer ${token}`,
        },
      }),
    ))!;
    if (response.status !== 200) {
      return { status: response.status, names: [] as string[] };
    }
    let { data } = JSON.parse(await response.text());
    return {
      status: 200,
      names: Object.keys(data.relationships ?? {}).sort(),
    };
  }

  async function operations(token: string, entries: unknown[]) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}_operations`, {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.BoxelOperations,
          'Content-Type': SupportedMimeType.BoxelOperations,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 'boxel:operations': entries }),
      }),
    ))!;
    let text = await response.text();
    return { status: response.status, text, json: JSON.parse(text) };
  }

  async function atomic(token: string, ops: unknown[]) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}_atomic`, {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.JSONAPI,
          'Content-Type': SupportedMimeType.JSONAPI,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ 'atomic:operations': ops }),
      }),
    ))!;
    return { status: response.status, text: await response.text() };
  }

  function updateAda(name: string) {
    return {
      op: 'update',
      href: './people/ada.json',
      data: {
        type: 'source',
        attributes: {
          content: JSON.stringify({
            data: {
              type: 'card',
              attributes: { name, nicknames: [] },
              meta: { adoptsFrom: { module: '../person', name: 'Person' } },
            },
          }),
        },
        meta: {},
      },
    };
  }

  async function readCard(token: string, path: string) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}${path}`, {
        headers: {
          Accept: SupportedMimeType.CardJson,
          Authorization: `Bearer ${token}`,
        },
      }),
    ))!;
    let text = await response.text();
    return {
      status: response.status,
      text,
      data: response.status === 200 ? JSON.parse(text).data : undefined,
    };
  }

  // The cards a search for every Person finds, by path, each with its name.
  async function searchPeople(token: string) {
    let response = (await realm.handle(
      new Request(`${realmURL.href}_search`, {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.CardJson,
          'Content-Type': 'application/json',
          'X-HTTP-Method-Override': 'QUERY',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          filter: {
            'item.on': { module: `${realmURL.href}person`, name: 'Person' },
          },
          fields: { entry: ['item'] },
        }),
      }),
    ))!;
    let text = await response.text();
    if (response.status !== 200) {
      return { status: response.status, text, names: {} };
    }
    let doc = JSON.parse(text);
    let names: Record<string, unknown> = {};
    for (let resource of [...(doc.included ?? []), ...(doc.data ?? [])]) {
      if (resource.type === 'card') {
        names[String(resource.id).replace(realmURL.href, '')] =
          resource.attributes?.name;
      }
    }
    return { status: 200, text, names };
  }

  async function overlayRows(runId: string) {
    return (await dbAdapter.execute(
      `SELECT attempt, path, size FROM run_overlay_files WHERE run_id = $1 ORDER BY attempt, path`,
      { bind: [runId] },
    )) as { attempt: string; path: string; size: number }[];
  }

  test('a staged write is visible to the run and invisible to everyone else', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let staged = await writeText(token, 'cards/new.json', '{"staged":true}');
    assert.strictEqual(staged.status, 204, staged.text);

    assert.deepEqual(await readText(token, 'cards/new.json'), {
      status: 200,
      text: '{"staged":true}',
    });
    assert.strictEqual(
      (await readText(session(), 'cards/new.json')).status,
      404,
      'an ordinary reader does not see the staged file',
    );
    assert.strictEqual(
      (await realm.handle(
        new Request(`${realmURL.href}cards/new.json`, {
          method: 'HEAD',
          headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
        }),
      ))!.status,
      200,
      'the run finds that the staged file exists',
    );
  });

  test('a run reads the realm for a file it has not staged, and its staged copy once it has', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    assert.deepEqual(await readText(token, 'notes.txt'), {
      status: 200,
      text: 'in the realm',
    });
    await writeText(token, 'notes.txt', 'staged over the realm');
    assert.deepEqual(await readText(token, 'notes.txt'), {
      status: 200,
      text: 'staged over the realm',
    });
    assert.deepEqual(
      await readText(session(), 'notes.txt'),
      { status: 200, text: 'in the realm' },
      'the realm keeps its own copy',
    );
  });

  test('binary content is staged byte for byte', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let bytes = new Uint8Array([0, 255, 128, 1, 2, 3, 0xc3, 0x28]);
    assert.strictEqual(await writeBytes(token, 'images/pixel.bin', bytes), 204);
    let response = (await realm.handle(
      new Request(`${realmURL.href}images/pixel.bin`, {
        headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
      }),
    ))!;
    assert.strictEqual(response.status, 200);
    assert.deepEqual([...(await body(response))], [...bytes]);
    assert.strictEqual(
      (await readText(session(), 'images/pixel.bin')).status,
      404,
    );
  });

  test('a run lists its staged files beside the realm’s, and nobody else does', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    await writeText(token, 'logs/2026-12.jsonl', '{"n":2}\n');
    await writeText(token, 'reports/weekly/one.md', '# one');

    assert.deepEqual((await list(token, 'logs/')).names, [
      '2026-11.jsonl',
      '2026-12.jsonl',
    ]);
    assert.deepEqual((await list(session(), 'logs/')).names, ['2026-11.jsonl']);
    assert.true(
      (await list(token)).names.includes('reports/'),
      'a directory only staged files make is listed for the run',
    );
    assert.deepEqual((await list(token, 'reports/')).names, ['weekly/']);
    assert.deepEqual((await list(token, 'reports/weekly/')).names, ['one.md']);
    assert.strictEqual(
      (await list(session(), 'reports/')).status,
      404,
      'the realm has no such directory',
    );
  });

  test('the writes cap bounds the files a run stages, and a rewrite does not count again', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
      {
        writesCap: 2,
      },
    );
    assert.strictEqual((await writeText(token, 'a.txt', 'a')).status, 204);
    assert.strictEqual((await writeText(token, 'b.txt', 'b')).status, 204);
    let refused = await writeText(token, 'c.txt', 'c');
    assert.strictEqual(refused.status, 403);
    assert.true(refused.text.includes('at most 2 files'), refused.text);
    assert.strictEqual(
      (await writeText(token, 'a.txt', 'a again')).status,
      204,
      'rewriting a staged file is not another file',
    );
    assert.deepEqual(
      (await overlayRows(run.id)).map((r) => r.path),
      ['a.txt', 'b.txt'],
    );
  });

  test('a run may not write realm.json', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    assert.strictEqual(
      (await writeText(token, 'realm.json', '{}')).status,
      403,
    );
    assert.deepEqual(await overlayRows(run.id), []);
  });

  test('a run may not write a module', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    for (let path of ['mine.gts', 'mine.ts', 'mine.gjs', 'mine.js']) {
      let refused = await writeText(token, path, `export class Mine {}`);
      assert.strictEqual(refused.status, 403, `${path}: ${refused.text}`);
    }
    assert.deepEqual(await overlayRows(run.id), []);
  });

  test('a run may not write a file a module’s name would resolve to', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    let refused = await writeText(token, 'thing', `export class Thing {}`);
    assert.strictEqual(refused.status, 403, refused.text);
    assert.deepEqual(await overlayRows(run.id), []);
  });

  test('a run’s card may not name a type from a file that isn’t a module', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    let source = `import { Automation } from '@cardstack/catalog/automation/automation';
export class Mine extends Automation {}`;
    assert.strictEqual(
      (await writeText(token, 'mine.txt', source)).status,
      204,
      'plain text is staged',
    );
    let card = (module: string, name: string) =>
      JSON.stringify({
        data: {
          type: 'card',
          attributes: {},
          meta: { adoptsFrom: { module, name } },
        },
      });
    for (let module of ['./mine.txt', './mine', './nowhere']) {
      let refused = await writeText(token, 'x.json', card(module, 'Mine'));
      assert.strictEqual(refused.status, 403, `${module}: ${refused.text}`);
    }
    // A key spelled with escapes names the same type once parsed.
    for (let [module, name] of [
      ['@cardstack/catalog/automation/automation', 'Automation'],
      ['@cardstack/catalog/realm-policy/realm-policy', 'RealmPolicy'],
      ['./mine.txt', 'Mine'],
    ]) {
      let escaped = card(module, name).replace(
        '"adoptsFrom"',
        '"\\u0061doptsFrom"',
      );
      assert.false(escaped.includes('adoptsFrom'), 'the key is escaped');
      let refused = await writeText(token, 'x.json', escaped);
      assert.strictEqual(refused.status, 403, `${module}: ${refused.text}`);
    }
    // A reader decodes a bad byte as U+FFFD and drops a leading byte-order
    // mark, so either would leave the card readable but unjudged.
    let encoder = new TextEncoder();
    for (let [module, name] of [
      ['@cardstack/catalog/automation/automation', 'Automation'],
      ['@cardstack/catalog/realm-policy/realm-policy', 'RealmPolicy'],
    ]) {
      let document = JSON.stringify({
        data: {
          type: 'card',
          attributes: { title: 'BAD' },
          meta: { adoptsFrom: { module, name } },
        },
      });
      let [before, after] = document.split('BAD');
      let badByte = new Uint8Array([
        ...encoder.encode(before),
        0xff,
        ...encoder.encode(after),
      ]);
      let byteOrderMark = new Uint8Array([
        0xef,
        0xbb,
        0xbf,
        ...encoder.encode(document),
      ]);
      for (let [label, bytes] of [
        ['a bad byte', badByte],
        ['a byte-order mark', byteOrderMark],
      ] as const) {
        assert.strictEqual(
          await writeBytes(token, 'x.json', bytes),
          403,
          `${name} with ${label} as octet-stream`,
        );
        let asSource = (await realm.handle(
          new Request(`${realmURL.href}x.json`, {
            method: 'POST',
            headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
            body: bytes,
          }),
        ))!;
        assert.strictEqual(
          asSource.status,
          403,
          `${name} with ${label} as card source`,
        );
      }
    }
    let named = await writeText(token, 'y.json', card('./thing', 'Thing'));
    assert.strictEqual(named.status, 204, named.text);
    assert.deepEqual(
      (await overlayRows(run.id)).map((row) => row.path),
      ['mine.txt', 'y.json'],
    );
  });

  test('a run’s removal is refused, and the realm keeps its file', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    let removal = (await realm.handle(
      new Request(`${realmURL.href}notes.txt`, {
        method: 'DELETE',
        headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
      }),
    ))!;
    assert.strictEqual(removal.status, 403, await removal.text());

    let batch = await operations(token, [
      { op: 'invoke', 'boxel:name': 'delete', href: './people/ada' },
    ]);
    assert.strictEqual(batch.status, 403, batch.text);
    assert.strictEqual(batch.json.errors?.[0]?.code, 'run-write-not-staged');

    assert.deepEqual(await readText(session(), 'notes.txt'), {
      status: 200,
      text: 'in the realm',
    });
    assert.strictEqual(
      (await readCard(session(), 'people/ada')).status,
      200,
      'the card the run tried to remove is still there',
    );
    assert.deepEqual(await overlayRows(run.id), []);
  });

  test('a run’s appendLine is applied to its overlay, and the run reads the line back', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    for (let n of [2, 3]) {
      let answer = await operations(token, [
        {
          op: 'invoke',
          'boxel:name': 'appendLine',
          href: './logs/2026-11.jsonl',
          data: { line: `{"n":${n}}` },
        },
      ]);
      assert.strictEqual(answer.status, 200, answer.text);
    }
    assert.deepEqual(
      await readText(token, 'logs/2026-11.jsonl'),
      { status: 200, text: '{"n":1}\n{"n":2}\n{"n":3}\n' },
      'the second append is made to the file as the first left it',
    );
    assert.deepEqual(
      await readText(session(), 'logs/2026-11.jsonl'),
      { status: 200, text: '{"n":1}\n' },
      'an ordinary reader sees the realm’s file',
    );
    assert.deepEqual(
      (await overlayRows(run.id)).map((row) => row.path),
      ['logs/2026-11.jsonl'],
    );
  });

  test('a run’s write operation on a card is applied to its overlay, and the run reads the card back', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let answer = await operations(token, [
      {
        op: 'invoke',
        'boxel:name': 'appendContainsMany',
        href: './people/ada',
        data: { field: 'nicknames', items: ['Countess'] },
      },
    ]);
    assert.strictEqual(answer.status, 200, answer.text);

    let second = await operations(token, [
      {
        op: 'invoke',
        'boxel:name': 'appendContainsMany',
        href: './people/ada',
        data: { field: 'nicknames', items: ['Enchantress'] },
      },
    ]);
    assert.strictEqual(second.status, 200, second.text);

    let staged = await readCard(token, 'people/ada');
    assert.strictEqual(staged.status, 200, staged.text);
    assert.deepEqual(
      staged.data.attributes.nicknames,
      ['Countess', 'Enchantress'],
      'the second append splices into the card as the first staged it',
    );
    assert.deepEqual(
      (await readCard(session(), 'people/ada')).data.attributes.nicknames,
      [],
      'an ordinary reader sees the indexed card',
    );
  });

  test('a run’s cards.update is staged, and its card read and search answer the staged card', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    let update = await atomic(token, [updateAda('Ada Lovelace')]);
    assert.strictEqual(update.status, 201, update.text);
    assert.deepEqual(
      (await overlayRows(run.id)).map((row) => row.path),
      ['people/ada.json'],
    );

    let staged = await readCard(token, 'people/ada');
    assert.strictEqual(staged.status, 200, staged.text);
    assert.strictEqual(staged.data.attributes.name, 'Ada Lovelace');
    assert.strictEqual(staged.data.id, `${realmURL.href}people/ada`);
    assert.strictEqual(
      staged.data.meta.adoptsFrom.module,
      `${realmURL.href}person`,
      'the type’s module is resolved against the card',
    );

    let found = await searchPeople(token);
    assert.strictEqual(found.status, 200, found.text);
    assert.deepEqual(
      found.names,
      { 'people/ada': 'Ada Lovelace' },
      'the search hit comes back staged',
    );

    assert.strictEqual(
      (await readCard(session(), 'people/ada')).data.attributes.name,
      'Ada',
      'an ordinary reader’s card read sees the indexed card',
    );
    assert.deepEqual(
      (await searchPeople(session())).names,
      { 'people/ada': 'Ada' },
      'an ordinary reader’s search sees the indexed card',
    );
  });

  test('a run’s update operation merges into the card as the run staged it', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let renamed = await atomic(token, [updateAda('Ada Lovelace')]);
    assert.strictEqual(renamed.status, 201, renamed.text);
    let update = await operations(token, [
      {
        op: 'invoke',
        'boxel:name': 'update',
        href: './people/ada',
        data: {
          type: 'card',
          attributes: { nicknames: ['Countess'] },
          meta: {
            adoptsFrom: { module: `${realmURL.href}person`, name: 'Person' },
          },
        },
      },
    ]);
    assert.strictEqual(update.status, 200, update.text);
    let staged = await readCard(token, 'people/ada');
    assert.strictEqual(staged.data.attributes.name, 'Ada Lovelace');
    assert.deepEqual(staged.data.attributes.nicknames, ['Countess']);
  });

  test('a card read of a staged file that isn’t a card document is refused, not answered from the realm', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let write = await writeText(token, 'people/ada.json', 'not a document');
    assert.strictEqual(write.status, 204, write.text);
    let read = await readCard(token, 'people/ada');
    assert.strictEqual(read.status, 422, read.text);
    assert.strictEqual(
      (await readCard(session(), 'people/ada')).data.attributes.name,
      'Ada',
    );
  });

  test('racing writes can’t stage a path both as a file and as a directory', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    let answers = await Promise.all([
      writeText(token, 'drafts', 'a file'),
      writeText(token, 'drafts/one.md', 'under a directory'),
    ]);
    assert.deepEqual(
      answers.map(({ status }) => status).sort(),
      [204, 409],
      'one of the two is staged and the other refused',
    );
    assert.strictEqual((await overlayRows(run.id)).length, 1);
  });

  test('a card a run creates is read back, and a search does not find it', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let add = await atomic(token, [
      {
        op: 'add',
        href: './people/grace.json',
        data: {
          type: 'card',
          attributes: { name: 'Grace', nicknames: [] },
          meta: { adoptsFrom: { module: '../person', name: 'Person' } },
        },
      },
    ]);
    assert.strictEqual(add.status, 201, add.text);
    let again = await atomic(token, [
      {
        op: 'add',
        href: './people/grace.json',
        data: {
          type: 'card',
          attributes: { name: 'Grace' },
          meta: { adoptsFrom: { module: '../person', name: 'Person' } },
        },
      },
    ]);
    assert.strictEqual(
      again.status,
      409,
      'an add sees the file the run staged',
    );

    let created = await readCard(token, 'people/grace');
    assert.strictEqual(created.status, 200, created.text);
    assert.strictEqual(created.data.attributes.name, 'Grace');
    assert.deepEqual(
      (await searchPeople(token)).names,
      { 'people/ada': 'Ada' },
      'the search runs on the index, which never sees a staged card',
    );
    assert.strictEqual((await readCard(session(), 'people/grace')).status, 404);
  });

  test('a run’s atomic write stages every file or none', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    let answer = await atomic(token, [
      updateAda('Ada Lovelace'),
      {
        op: 'add',
        href: './sneaky.gts',
        data: { type: 'source', attributes: { content: '' }, meta: {} },
      },
    ]);
    assert.strictEqual(answer.status, 403, answer.text);
    assert.deepEqual(await overlayRows(run.id), [], 'nothing is staged');
  });

  test('a run’s write operation meets the checks a staged write does', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
      { writesCap: 1 },
    );
    let first = await operations(token, [
      {
        op: 'invoke',
        'boxel:name': 'appendLine',
        href: './logs/2026-11.jsonl',
        data: { line: '{"n":2}' },
      },
    ]);
    assert.strictEqual(first.status, 200, first.text);
    let second = await operations(token, [
      {
        op: 'invoke',
        'boxel:name': 'appendContainsMany',
        href: './people/ada',
        data: { field: 'nicknames', items: ['Countess'] },
      },
    ]);
    assert.strictEqual(second.status, 403, second.text);
    assert.strictEqual(second.json.errors?.[0]?.code, 'run-write-refused');
    assert.deepEqual(
      (await overlayRows(run.id)).map((row) => row.path),
      ['logs/2026-11.jsonl'],
    );
  });

  test('a run’s staged files are bounded in bytes together, and a rewrite counts once', async function (assert) {
    let { run } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let key = { runId: run.id, attempt: run.attempt! };
    let bytes = (n: number) => new Uint8Array(n);
    assert.strictEqual(
      (await stageRunOverlayFile(dbAdapter, key, 'a.bin', bytes(6), 10, 10))
        .kind,
      'staged',
    );
    assert.deepEqual(
      await stageRunOverlayFile(dbAdapter, key, 'b.bin', bytes(5), 10, 10),
      { kind: 'over-bytes', limit: 10 },
    );
    assert.strictEqual(
      (await stageRunOverlayFile(dbAdapter, key, 'a.bin', bytes(10), 10, 10))
        .kind,
      'staged',
      'a rewrite replaces its own bytes rather than adding to them',
    );
    assert.deepEqual(
      (await overlayRows(run.id)).map((row) => [row.path, Number(row.size)]),
      [['a.bin', 10]],
    );
  });

  test('a run cannot stage in a realm it may only read', async function (assert) {
    let { run } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let token = mintRunToken({
      realmSecretSeed,
      run: {
        ...run,
        realm: 'http://127.0.0.1:4444/run-overlay-elsewhere/' as never,
      },
      realmURL: 'http://127.0.0.1:4444/run-overlay-elsewhere/',
      readRealms: [realmURL.href],
      writesCap: 10,
      realmServerURL: realm.realmServerURL,
      timeLimitSeconds: 600,
    });
    assert.strictEqual(
      (await writeText(token, 'outside.txt', 'nope')).status,
      403,
    );
    assert.deepEqual(await overlayRows(run.id), []);
  });

  test('a retry that takes the run over starts from an empty overlay', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    await writeText(token, 'first.txt', 'from attempt 1');
    await startAutomationRunAttempt(dbAdapter, run.id, 2);
    let retry = mintRunToken({
      realmSecretSeed,
      run: { ...run, attempt: 2 },
      realmURL: realmURL.href,
      readRealms: [],
      writesCap: 10,
      realmServerURL: realm.realmServerURL,
      timeLimitSeconds: 600,
    });
    assert.strictEqual((await readText(retry, 'first.txt')).status, 404);
    assert.deepEqual(
      await overlayRows(run.id),
      [],
      'the replaced attempt’s staged files are dropped',
    );
    assert.strictEqual(
      (await writeText(token, 'late.txt', 'from attempt 1')).status,
      401,
      'the replaced attempt can no longer stage',
    );
  });

  test('large binary content round-trips byte for byte', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let bytes = new Uint8Array(200_003);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 7919 + (i >> 8)) & 0xff;
    }
    assert.strictEqual(await writeBytes(token, 'big.bin', bytes), 204);
    let response = (await realm.handle(
      new Request(`${realmURL.href}big.bin`, {
        headers: { Accept: SOURCE, Authorization: `Bearer ${token}` },
      }),
    ))!;
    let back = await body(response);
    assert.strictEqual(back.byteLength, bytes.byteLength);
    assert.true(
      back.every((b, i) => b === bytes[i]),
      'every byte is the byte staged',
    );
  });

  test('staging holds a file to the limit the realm’s own write would', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    let padding = 'x'.repeat(600 * 1024);
    let card = JSON.stringify({
      data: {
        type: 'card',
        attributes: { padding },
        meta: { adoptsFrom: { module: './thing', name: 'Thing' } },
      },
    });
    assert.strictEqual(
      (await writeText(token, 'cards/huge.json', card)).status,
      413,
      'a card document past the card limit is refused',
    );
    assert.strictEqual(
      (await writeText(token, 'data/big.json', JSON.stringify({ padding })))
        .status,
      204,
      'a .json file that is not a card takes the file limit',
    );
  });

  test('a path is not staged as both a file and a directory', async function (assert) {
    let { token } = await createAutomationRunToken(dbAdapter, realm, OWNER);
    assert.strictEqual((await writeText(token, 'clash', 'a file')).status, 204);
    assert.strictEqual(
      (await writeText(token, 'clash/inside.txt', 'under it')).status,
      409,
    );
    assert.strictEqual(
      (await writeText(token, 'dir/inside.txt', 'under it')).status,
      204,
    );
    assert.strictEqual((await writeText(token, 'dir', 'a file')).status, 409);
    assert.strictEqual(
      (await writeText(token, 'clash2', 'a sibling name')).status,
      204,
      'a sibling whose name starts the same is no clash',
    );
  });

  test('a card the commit would refuse is refused at staging, through each staging route, as the commit refuses it', async function (assert) {
    // A file at `Person` in the realm, which is where a Person card the
    // envelope creates gets its directory, so every card below would be under
    // a path the realm holds as a file.
    assert.strictEqual(
      (await writeText(session(), 'Person', 'a file, not a directory')).status,
      204,
    );
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    let card = {
      data: {
        type: 'card',
        attributes: { name: 'Grace', nicknames: [] },
        meta: { adoptsFrom: { module: '../person', name: 'Person' } },
      },
    };

    // What the commit answers for the same card, staged in the overlay
    // directly, as a realm that changed since staging would leave it.
    let other = await createAutomationRunToken(dbAdapter, realm, OWNER);
    await stageRunOverlayFile(
      dbAdapter,
      { runId: other.run.id, attempt: other.run.attempt! },
      'Person/grace.json',
      new TextEncoder().encode(JSON.stringify(card)),
      10,
    );
    let committed = await realm.handle(
      new Request(`${realmURL.href}${RUN_COMMIT_PATH.slice(1)}`, {
        method: 'POST',
        headers: {
          Accept: SupportedMimeType.JSONAPI,
          Authorization: `Bearer ${other.token}`,
        },
      }),
    );
    let commitText = await committed!.text();
    assert.strictEqual(committed!.status, 409, commitText);
    let commitError = JSON.parse(commitText).errors[0];
    assert.strictEqual(commitError.code, 'path-clash');
    assert.ok(
      commitError.detail.endsWith('; nothing was saved'),
      commitError.detail,
    );
    let reason = commitError.detail.replace(/; nothing was saved$/, '');

    let written = await writeText(
      token,
      'Person/grace.json',
      JSON.stringify(card),
    );
    assert.strictEqual(written.status, 409, 'the card+source write');
    let writeError = JSON.parse(written.text).errors[0];
    assert.strictEqual(writeError.code, 'path-clash');
    assert.strictEqual(writeError.detail, reason);

    let added = await atomic(token, [
      { op: 'add', href: './Person/grace.json', data: card.data },
    ]);
    assert.strictEqual(added.status, 409, `the atomic write: ${added.text}`);
    let addError = JSON.parse(added.text).errors[0];
    assert.strictEqual(addError.code, 'path-clash');
    assert.strictEqual(addError.detail, reason);

    let created = await operations(token, [
      {
        op: 'invoke',
        'boxel:name': 'create',
        data: {
          lid: 'grace',
          attributes: { name: 'Grace', nicknames: [] },
          meta: {
            adoptsFrom: { module: `${realmURL.href}person`, name: 'Person' },
          },
        },
      },
    ]);
    assert.strictEqual(
      created.status,
      409,
      `the operations envelope: ${created.text}`,
    );
    let createError = created.json.errors[0];
    assert.strictEqual(createError.code, 'run-write-refused');
    assert.strictEqual(createError.detail, reason);

    assert.deepEqual(await overlayRows(run.id), [], 'nothing is staged');
  });

  test('a run may not stage at a path the realm reserves, and is refused as the commit refuses it', async function (assert) {
    let { token, run } = await createAutomationRunToken(
      dbAdapter,
      realm,
      OWNER,
    );
    // A part-written file's name routes to no staging route, so a run's
    // write there is refused before it is routed.
    let written = await writeText(token, 'notes.txt.boxel-partial', 'nope');
    assert.strictEqual(written.status, 403, written.text);
    let added = await atomic(token, [
      {
        op: 'add',
        href: './notes.txt.boxel-partial',
        data: { type: 'source', attributes: { content: 'nope' }, meta: {} },
      },
    ]);
    assert.strictEqual(added.status, 403, added.text);
    assert.strictEqual(JSON.parse(added.text).errors[0].code, 'forbidden-path');
    assert.deepEqual(await overlayRows(run.id), []);
  });

  for (let [ending, end] of [
    [
      'finishes complete (a Preview)',
      (id: string) =>
        finishAutomationRun(dbAdapter, id, 1, { state: 'complete' }),
    ],
    [
      'fails',
      (id: string) =>
        finishAutomationRun(dbAdapter, id, 1, {
          state: 'error',
          reason: 'script-error',
        }),
    ],
    ['is canceled', (id: string) => cancelAutomationRun(dbAdapter, id, OWNER)],
    [
      'is abandoned',
      (id: string) => abandonAutomationRun(dbAdapter, id, 'timed-out'),
    ],
  ] as const) {
    test(`a run that ${ending} leaves no staged file behind`, async function (assert) {
      let { token, run } = await createAutomationRunToken(
        dbAdapter,
        realm,
        OWNER,
      );
      await writeText(token, 'scratch.txt', 'staged');
      await writeBytes(token, 'scratch.bin', new Uint8Array([1, 2, 3]));
      assert.strictEqual((await overlayRows(run.id)).length, 2);
      assert.ok(await end(run.id), 'the run ended');
      assert.deepEqual(await overlayRows(run.id), []);
      assert.strictEqual(
        (await readText(session(), 'scratch.txt')).status,
        404,
        'nothing reached the realm',
      );
    });
  }
});
