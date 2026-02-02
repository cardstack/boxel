import { module, test } from 'qunit';
import { basename } from 'path';
import { setupServerEndpointsTest, testRealm2URL } from './helpers';
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

module(`server-endpoints/${basename(__filename)}`, function (hooks) {
  let context = setupServerEndpointsTest(hooks);

  test('downloads realm as a zip archive', async function (assert) {
    let response = await context.request2
      .get('/_download-realm')
      .query({ realm: testRealm2URL.href })
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
      response.body.includes(Buffer.from('.realm.json')),
      'archive includes realm files',
    );
  });

  test('requires auth when realm is not public', async function (assert) {
    await context.dbAdapter.execute(
      `DELETE FROM realm_user_permissions WHERE realm_url = '${testRealm2URL.href}' AND username = '*'`,
    );

    let response = await context.request2
      .get('/_download-realm')
      .query({ realm: testRealm2URL.href });

    assert.strictEqual(response.status, 401, 'returns unauthorized');
  });

  test('returns 400 when realm is missing from query params', async function (assert) {
    let response = await context.request2.get('/_download-realm');

    assert.strictEqual(response.status, 400, 'returns bad request');
    assert.ok(
      response.body.errors?.[0]?.includes('single realm must be specified'),
      'explains required realm parameter',
    );
  });

  test('returns 404 when realm is not registered on the server', async function (assert) {
    let response = await context.request2
      .get('/_download-realm')
      .query({ realm: 'http://127.0.0.1:4445/missing/' });

    assert.strictEqual(response.status, 404, 'returns not found');
    assert.ok(
      response.body.errors?.[0]?.includes('Realm not found'),
      'explains missing realm',
    );
  });
});
