import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename, join } from 'path';
import { mkdirSync, writeFileSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { setupServerEndpointsTest, testRealmURL } from './helpers.ts';
import { realmSecretSeed } from '../helpers/index.ts';
import { createJWT } from '../../utils/jwt.ts';
import { createURLSignatureSync } from '@cardstack/runtime-common/url-signature-node';
import type { Response } from 'superagent';

function binaryParser(
  res: Response,
  callback: (err: Error | null, body: Buffer) => void,
) {
  let data = '';

  res.setEncoding('binary');

  res.on('data', (chunk: string) => {
    data += chunk;
  });

  res.on('end', () => {
    callback(null, Buffer.from(data, 'binary'));
  });
}

module(`server-endpoints/${basename(import.meta.filename)}`, function (hooks) {
  // Use the `simple` fixture so the realm has real card files to assert
  // the archive contains; the `blank` fixture has no card content.
  let context = setupServerEndpointsTest(hooks, { fixture: 'simple' });

  test('downloads realm as a zip archive', async function (assert) {
    let response = await context.request
      .get('/_download-realm')
      .query({ realm: testRealmURL.href })
      .buffer(true)
      .parse(binaryParser);

    let bodyPreview = response.body?.toString?.('utf8') ?? response.text ?? '';
    assert.strictEqual(response.status, 200, bodyPreview.slice(0, 200));
    assert.strictEqual(
      response.headers['content-type'],
      'application/zip',
      'serves a zip archive',
    );
    assert.ok(
      response.headers['content-disposition']?.includes('.zip'),
      'includes attachment filename',
    );
    assert.ok(response.body instanceof Buffer, 'response body is a Buffer');
    assert.strictEqual(
      response.body.subarray(0, 2).toString('utf8'),
      'PK',
      'zip file signature is present',
    );
    assert.ok(
      response.body.includes(Buffer.from('person.gts')),
      'archive includes realm files',
    );
  });

  test('requires auth when realm is not public', async function (assert) {
    await context.dbAdapter.execute(
      `DELETE FROM realm_user_permissions WHERE realm_url = '${testRealmURL.href}' AND username = '*'`,
    );

    let response = await context.request
      .get('/_download-realm')
      .query({ realm: testRealmURL.href });

    assert.strictEqual(response.status, 401, 'returns unauthorized');
  });

  test('returns 400 when realm is missing from query params', async function (assert) {
    let response = await context.request.get('/_download-realm');

    assert.strictEqual(response.status, 400, 'returns bad request');
    assert.ok(
      response.body.errors?.[0]?.includes('single realm must be specified'),
      'explains required realm parameter',
    );
  });

  test('returns 404 when realm is not registered on the server', async function (assert) {
    let response = await context.request
      .get('/_download-realm')
      .query({ realm: 'http://127.0.0.1:4445/missing/' });

    assert.strictEqual(response.status, 404, 'returns not found');
    assert.ok(
      response.body.errors?.[0]?.includes('Realm not found'),
      'explains missing realm',
    );
  });

  test('accepts auth token via query param with valid signature', async function (assert) {
    // Remove public permissions to require authentication
    await context.dbAdapter.execute(
      `DELETE FROM realm_user_permissions WHERE realm_url = '${testRealmURL.href}' AND username = '*'`,
    );

    // Add read permission for the test user
    let testUser = '@test:localhost';
    await context.dbAdapter.execute(
      `INSERT INTO realm_user_permissions (realm_url, username, read, write, realm_owner)
       VALUES ('${testRealmURL.href}', '${testUser}', true, false, false)`,
    );

    // Create a valid JWT token
    let token = createJWT(
      { user: testUser, sessionRoom: '!test:localhost' },
      realmSecretSeed,
    );

    // Build the URL and compute signature
    let downloadURL = new URL('/_download-realm', testRealmURL.origin);
    downloadURL.searchParams.set('realm', testRealmURL.href);
    downloadURL.searchParams.set('token', token);
    let sig = createURLSignatureSync(token, downloadURL);

    // Request with token and signature in query params
    let response = await context.request
      .get('/_download-realm')
      .query({ realm: testRealmURL.href, token, sig })
      .buffer(true)
      .parse(binaryParser);

    let bodyPreview = response.body?.toString?.('utf8') ?? response.text ?? '';
    assert.strictEqual(response.status, 200, bodyPreview.slice(0, 200));
    assert.strictEqual(
      response.headers['content-type'],
      'application/zip',
      'serves a zip archive with token auth',
    );
  });

  test('rejects token via query param without signature', async function (assert) {
    // Remove public permissions to require authentication
    await context.dbAdapter.execute(
      `DELETE FROM realm_user_permissions WHERE realm_url = '${testRealmURL.href}' AND username = '*'`,
    );

    let token = createJWT(
      { user: '@test:localhost', sessionRoom: '!test:localhost' },
      realmSecretSeed,
    );

    let response = await context.request
      .get('/_download-realm')
      .query({ realm: testRealmURL.href, token });

    assert.strictEqual(
      response.status,
      400,
      'returns bad request when signature is missing',
    );
  });

  test('rejects token via query param with invalid signature', async function (assert) {
    // Remove public permissions to require authentication
    await context.dbAdapter.execute(
      `DELETE FROM realm_user_permissions WHERE realm_url = '${testRealmURL.href}' AND username = '*'`,
    );

    let token = createJWT(
      { user: '@test:localhost', sessionRoom: '!test:localhost' },
      realmSecretSeed,
    );

    let response = await context.request
      .get('/_download-realm')
      .query({ realm: testRealmURL.href, token, sig: 'invalid-signature' });

    assert.strictEqual(
      response.status,
      401,
      'returns unauthorized for invalid signature',
    );
  });

  // CS-11270 regression: Phase 3 lazy mount (CS-10894) means non-pinned
  // source/published realms aren't in `realms[]` after a realm-server
  // restart until something has driven a request-path lookupOrMount for
  // them. Pre-fix, /_download-realm gated on `realms.some(...)` and
  // 404'd for any realm not yet mounted on this instance. Post-fix the
  // handler resolves the realm's disk path from `realm_registry`
  // directly (kind + disk_id) so downloads of post-restart non-pinned
  // realms succeed without needing a mount. The fix is intentionally
  // mount-free: the download is a stream of on-disk files, no realm
  // process work is required.
  test('downloads a source realm that has a registry row but is not mounted (post-restart)', async function (assert) {
    let realmId = `unmounted-${uuidv4()}`;
    let realmsRootPath = context.testRealmServer.testingOnlyRealmsRootPath;
    let realmDir = join(realmsRootPath, realmId);
    mkdirSync(realmDir, { recursive: true });
    writeFileSync(
      join(realmDir, 'realm.json'),
      JSON.stringify(
        {
          data: {
            type: 'card',
            attributes: { cardInfo: { name: 'CS-11270 regression realm' } },
            meta: {
              adoptsFrom: {
                module: '@cardstack/base/realm-config',
                name: 'RealmConfig',
              },
            },
          },
        },
        null,
        2,
      ),
    );
    writeFileSync(join(realmDir, 'marker.txt'), 'cs-11270-regression-marker');

    // Anchor the new realm's URL to the test server's origin so the
    // URL is structurally identical to the testRealm's (same host:port,
    // different path) — keeps the test representative of a real
    // post-restart download against this server and won't get caught
    // out if `_download-realm` ever grows an "is this URL hosted by
    // this realm-server?" check.
    let realmHref = new URL(`/${realmId}/`, testRealmURL.origin).href;
    await context.dbAdapter.execute(`INSERT INTO realm_registry
        (url, kind, disk_id, owner_username, pinned)
        VALUES (
          '${realmHref}',
          'source',
          '${realmId}',
          'cs-11270-owner',
          false
        )`);
    await context.dbAdapter.execute(`INSERT INTO realm_user_permissions
        (realm_url, username, read, write, realm_owner)
        VALUES ('${realmHref}', '*', true, false, false)`);

    // Precondition: the realm is NOT mounted in this process. realms[]
    // is empty for this URL, reconciler.mounted has no entry — i.e.
    // exactly the post-restart state CS-11270 is about.
    let mountedRealms = context.testRealmServer.testingOnlyRealms.map(
      (r) => r.url,
    );
    assert.notOk(
      mountedRealms.includes(realmHref),
      'precondition: realm is absent from realms[]',
    );

    let response = await context.request
      .get('/_download-realm')
      .query({ realm: realmHref })
      .buffer(true)
      .parse(binaryParser);

    let bodyPreview = response.body?.toString?.('utf8') ?? response.text ?? '';
    assert.strictEqual(response.status, 200, bodyPreview.slice(0, 200));
    assert.strictEqual(
      response.headers['content-type'],
      'application/zip',
      'serves a zip archive',
    );
    assert.ok(response.body instanceof Buffer, 'response body is a Buffer');
    assert.strictEqual(
      response.body.subarray(0, 2).toString('utf8'),
      'PK',
      'zip file signature is present',
    );
    assert.ok(
      response.body.includes(Buffer.from('marker.txt')),
      'archive includes the on-disk files',
    );
    // Postcondition: the handler did NOT mount the realm — the download
    // is a pure on-disk read, no realm.start() should have been
    // triggered as a side effect.
    let mountedAfter = context.testRealmServer.testingOnlyRealms.map(
      (r) => r.url,
    );
    assert.notOk(
      mountedAfter.includes(realmHref),
      'handler did not mount the realm as a side effect of the download',
    );
  });

  // Defense-in-depth: `disk_id` is just a string column on
  // `realm_registry`. Today every write path validates input
  // (`create-realm.ts` accepts endpoints matching /^[a-z0-9-]+$/ only),
  // but the path resolver shouldn't trust that — a future write path
  // (or a backfill rebuilt from an operator-controlled disk layout)
  // could store an absolute path or `..` segments. The handler must
  // refuse to zip anything outside `realmsRootPath`.
  test('refuses to resolve source realms whose disk_id escapes realmsRootPath', async function (assert) {
    let realmHref = new URL(`/traversal-${uuidv4()}/`, testRealmURL.origin)
      .href;
    await context.dbAdapter.execute(`INSERT INTO realm_registry
        (url, kind, disk_id, owner_username, pinned)
        VALUES (
          '${realmHref}',
          'source',
          '../etc',
          'cs-11270-owner',
          false
        )`);
    await context.dbAdapter.execute(`INSERT INTO realm_user_permissions
        (realm_url, username, read, write, realm_owner)
        VALUES ('${realmHref}', '*', true, false, false)`);

    let response = await context.request
      .get('/_download-realm')
      .query({ realm: realmHref });

    assert.strictEqual(
      response.status,
      404,
      'traversal disk_id is rejected before any file access',
    );
    assert.ok(
      response.body.errors?.[0]?.includes('not stored in realmsRootPath'),
      'error message points at the realmsRootPath constraint',
    );
  });

  test('rejects invalid token via query param', async function (assert) {
    // Remove public permissions to require authentication
    await context.dbAdapter.execute(
      `DELETE FROM realm_user_permissions WHERE realm_url = '${testRealmURL.href}' AND username = '*'`,
    );

    // Invalid token with a signature (signature doesn't matter since token is invalid)
    let response = await context.request
      .get('/_download-realm')
      .query({ realm: testRealmURL.href, token: 'invalid-token', sig: 'any' });

    assert.strictEqual(
      response.status,
      401,
      'returns unauthorized for invalid token',
    );
  });
});
