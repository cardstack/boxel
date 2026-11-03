import QUnit from 'qunit';
import Koa from 'koa';
import request from 'supertest';
import { Readable } from 'node:stream';
import { errorResponseFilterFromEnv } from '../lib/error-response-filter.ts';

const { module, test } = QUnit;
const nativePath = '/private/tmp/boxel-private-fixture';
const settings = {
  BOXEL_ERROR_DETAILS: 'redacted',
  BOXEL_ERROR_PRIVATE_PATH_PREFIXES: JSON.stringify([
    nativePath,
    '/Users/private-fixture',
  ]),
};

function appFor(handler: Koa.Middleware, env: NodeJS.ProcessEnv = settings) {
  let app = new Koa();
  app.silent = true;
  app.use(errorResponseFilterFromEnv(env));
  app.use(handler);
  return app;
}

module('native error response filtering', () => {
  test('authenticated JSON errors omit native paths and nested stacks while retaining actionable details', async (assert) => {
    let app = appFor((ctx) => {
      ctx.status = 500;
      ctx.type = 'application/vnd.api+json';
      ctx.set('ETag', 'original-error');
      ctx.body = JSON.stringify({
        errors: [
          {
            title: 'Card compilation failed',
            detail: `Cannot compile file://${nativePath}/card.gts:2:3`,
            stack: `Error\n    at compile (${nativePath}/runtime.ts:1:2)`,
            additionalErrors: [
              {
                message: `ENOENT: open '${nativePath}/missing.json'`,
                stack: 'private stack',
              },
            ],
          },
        ],
      });
    });
    let response = await request(app.callback())
      .get('/card')
      .set('Authorization', 'Bearer fixture')
      .set('X-Boxel-Internal', 'true');
    assert.strictEqual(response.status, 500);
    assert.strictEqual(
      response.body.errors[0].title,
      'Card compilation failed',
    );
    assert.false(response.text.includes(nativePath));
    assert.false(response.text.includes('file://'));
    assert.false(response.text.includes('stack'));
    assert.true(response.body.errors[0].detail.includes('[local file]'));
    assert.strictEqual(response.headers.etag, undefined);
    assert.strictEqual(
      Number(response.headers['content-length']),
      Buffer.byteLength(response.text),
    );
  });

  test('indexing and render errors in successful responses are filtered without changing ordinary card fields', async (assert) => {
    let original = {
      data: [
        {
          attributes: {
            notes: `User-authored text ${nativePath}/example.txt`,
            error: `User-authored error field ${nativePath}/example.txt`,
            errorDoc: {
              message: `Cannot read ${nativePath}/definition.gts`,
              stack: 'private stack',
            },
          },
        },
      ],
      error: `Cannot open ${nativePath}/root.json`,
      meta: {
        renderError: {
          message: 'at least one field is required',
          stack: 'private stack',
        },
      },
    };
    let app = appFor((ctx) => {
      ctx.type = 'application/vnd.card+json';
      ctx.body = original;
    });
    let response = await request(app.callback()).get('/_indexing-errors');
    assert.strictEqual(response.status, 200);
    assert.strictEqual(
      response.body.data[0].attributes.notes,
      original.data[0].attributes.notes,
    );
    assert.strictEqual(
      response.body.data[0].attributes.error,
      original.data[0].attributes.error,
    );
    assert.strictEqual(
      response.body.data[0].attributes.errorDoc.message,
      'Cannot read [local file]',
    );
    assert.strictEqual(
      response.body.meta.renderError.message,
      'at least one field is required',
    );
    assert.strictEqual(response.body.meta.renderError.stack, undefined);
    assert.strictEqual(response.body.error, 'Cannot open [local file]');
    assert.strictEqual(
      original.meta.renderError.stack,
      'private stack',
      'a cached object is not mutated',
    );
  });

  test('tool schemas containing error and stack field names are preserved', async (assert) => {
    let definition = {
      type: 'object',
      properties: {
        error: {
          type: 'object',
          title: 'Error',
          properties: {
            stack: { type: 'string' },
            message: { type: 'string' },
          },
        },
      },
    };
    let app = appFor((ctx) => {
      ctx.type = 'application/vnd.card.file-meta+json';
      ctx.body = {
        data: {
          attributes: {
            documentation: 'x'.repeat(1024 * 1024),
            toolDefinitions: [{ parameters: definition }],
          },
        },
      };
    });
    let response = await request(app.callback()).get('/SKILL.md');
    assert.strictEqual(
      response.status,
      200,
      'large successful file metadata is not treated as an oversized error',
    );
    assert.deepEqual(
      response.body.data.attributes.toolDefinitions[0].parameters,
      definition,
    );
  });

  test('text, string arrays and JSON strings cannot expose native paths or stack frames', async (assert) => {
    for (let body of [
      `Failed opening ${nativePath}/file.ts\n    at read (${nativePath}/source.ts:1:2)`,
      JSON.stringify([`${nativePath}/file.ts`]),
      JSON.stringify(`file://${nativePath}/file.ts`),
    ]) {
      let app = appFor((ctx) => {
        ctx.status = 500;
        ctx.body = body;
      });
      let response = await request(app.callback()).get('/failed');
      assert.false(response.text.includes(nativePath));
      assert.false(response.text.includes('file://'));
      assert.false(response.text.includes('at read'));
    }
  });

  test('unexpected exceptions retain a native diagnostic but expose only a generic message', async (assert) => {
    let error = new Error(`Cannot open ${nativePath}/secret-file`);
    let app = appFor(() => {
      throw error;
    });
    let observed: unknown[] = [];
    app.on('error', (diagnostic) => observed.push(diagnostic));
    let response = await request(app.callback()).get('/unexpected');
    assert.strictEqual(response.status, 500);
    assert.strictEqual(response.text, 'Request could not be completed.');
    assert.deepEqual(observed, [error]);
  });

  test('expected HTTP errors preserve status and safe explanations', async (assert) => {
    let app = appFor((ctx) =>
      ctx.throw(403, `Access denied to ${nativePath}/private`),
    );
    let response = await request(app.callback()).get('/denied');
    assert.strictEqual(response.status, 403);
    assert.strictEqual(response.text, 'Access denied to [local file]');
  });

  test('unfiltered successful sources and the default hosted mode retain their existing behavior', async (assert) => {
    let source = `export const path = '${nativePath}/example';`;
    let app = appFor((ctx) => {
      ctx.type = 'text/javascript';
      ctx.body = source;
    });
    assert.strictEqual(
      (await request(app.callback()).get('/module.gts')).text,
      source,
    );
    let hosted = appFor((ctx) => {
      ctx.status = 500;
      ctx.body = { errors: [{ stack: source }] };
    }, {});
    assert.strictEqual(
      (await request(hosted.callback()).get('/error')).body.errors[0].stack,
      source,
    );
  });

  test('error streams and excessive error payloads fail closed', async (assert) => {
    let stream = Readable.from([`${nativePath}/private.txt`]);
    let app = appFor((ctx) => {
      ctx.status = 500;
      ctx.body = stream;
    });
    let response = await request(app.callback()).get('/stream');
    assert.false(response.text.includes(nativePath));
    assert.true(stream.destroyed);
    let large = appFor((ctx) => {
      ctx.status = 500;
      ctx.body = 'x'.repeat(1024 * 1024 + 1) + nativePath;
    });
    let limited = await request(large.callback()).get('/large');
    assert.strictEqual(limited.status, 500);
    assert.false(limited.text.includes(nativePath));
    assert.true(limited.text.length < 200);
  });

  test('incomplete or ignored configuration fails startup', (assert) => {
    for (let env of [
      { BOXEL_ERROR_DETAILS: 'unknown' },
      { BOXEL_ERROR_DETAILS: 'redacted' },
      { BOXEL_ERROR_PRIVATE_PATH_PREFIXES: '[]' },
      { ...settings, BOXEL_ERROR_PRIVATE_PATH_PREFIXES: '["relative"]' },
      { ...settings, BOXEL_ERROR_PRIVATE_PATH_PREFIXES: '["/"]' },
    ])
      assert.throws(() => errorResponseFilterFromEnv(env));
  });
});
