import { module, test } from 'qunit';
import { basename } from 'path';
import { setupServerEndpointsTest, testRealm2URL } from './helpers';

function binaryParser(
  res: NodeJS.ReadableStream,
  callback: (err: Error | null, body: Buffer) => void,
) {
  res.setEncoding('binary');
  let data = '';
  res.on('data', (chunk) => {
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

    assert.strictEqual(response.status, 200, 'returns 200');
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
});
