import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import { randomBytes } from 'node:crypto';
import { logger } from '@cardstack/runtime-common';
import {
  configureOutbound,
  outboundFetch,
  resetOutbound,
} from '../lib/outbound/client.ts';
import {
  CredentialScrubber,
  MIN_PARTIAL_LENGTH,
  REDACTED,
} from '../lib/outbound/scrubber.ts';
import {
  startStubVendor,
  type StubVendor,
  type StubVendorResponse,
} from './helpers/stub-vendor.ts';

const KEY = 'sk-test-0f3a9c27b4e14d5a8e6b21c0d9f7a3e5';

// Every form a vendor might echo KEY back in.
function encodedForms(value: string): Record<string, string> {
  let bytes = Buffer.from(value, 'utf8');
  let hex = (byte: number) => byte.toString(16).padStart(2, '0');
  return {
    raw: value,
    'upper case': value.toUpperCase(),
    'base64, aligned': bytes.toString('base64'),
    'base64, one byte in': Buffer.concat([Buffer.from('x'), bytes])
      .toString('base64')
      .slice(2),
    'base64, two bytes in': Buffer.concat([Buffer.from('xy'), bytes])
      .toString('base64')
      .slice(3),
    base64url: Buffer.concat([Buffer.from('?>'), bytes]).toString('base64url'),
    'percent-encoded, upper hex': [...bytes]
      .map((byte) => `%${hex(byte).toUpperCase()}`)
      .join(''),
    'percent-encoded, lower hex': [...bytes]
      .map((byte) => `%${hex(byte)}`)
      .join(''),
    'percent-encoded, only some bytes': encodeURIComponent(value).replace(
      /-/g,
      '%2d',
    ),
    'JSON \\u escapes': [...value]
      .map((char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
      .join(''),
    'HTML decimal entities': [...value]
      .map((char) => `&#${char.charCodeAt(0)};`)
      .join(''),
    'HTML hex entities': [...value]
      .map((char) => `&#x${char.charCodeAt(0).toString(16)};`)
      .join(''),
  };
}

// Whether any run of `text` long enough to count as a partial echo of
// `planted` survived into `output`.
function leaked(output: string, planted: string): boolean {
  let haystack = output.toLowerCase();
  let needle = planted.toLowerCase();
  for (let start = 0; start + MIN_PARTIAL_LENGTH <= needle.length; start++) {
    if (haystack.includes(needle.slice(start, start + MIN_PARTIAL_LENGTH))) {
      return true;
    }
  }
  return false;
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (let chunk of chunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

function scrubberFor(...values: string[]): CredentialScrubber {
  let scrubber = new CredentialScrubber();
  for (let value of values) {
    scrubber.register(value);
  }
  return scrubber;
}

// Every line logged on the named channels while `fn` runs.
async function logsDuring(
  channels: string[],
  fn: () => Promise<void>,
): Promise<string[]> {
  let lines: string[] = [];
  let restore: (() => void)[] = [];
  for (let channel of channels) {
    let log = logger(channel);
    let originalFactory = log.methodFactory;
    let originalLevel = log.getLevel();
    log.methodFactory = (methodName, level, loggerName) => {
      let raw = originalFactory(methodName, level, loggerName);
      return (...args: unknown[]) => {
        lines.push(args.map(String).join(' '));
        raw(...args);
      };
    };
    log.setLevel('trace');
    restore.push(() => {
      log.methodFactory = originalFactory;
      log.setLevel(originalLevel);
    });
  }
  try {
    await fn();
  } finally {
    restore.forEach((undo) => undo());
  }
  return lines;
}

module(basename(import.meta.filename), function () {
  module('credential scrubber', function () {
    for (let [name, form] of Object.entries(encodedForms(KEY))) {
      test(`removes the value ${name}`, function (assert) {
        let output = scrubberFor(KEY).scrubText(
          `{"error":"bad key ${form} given"}`,
        );
        assert.false(leaked(output, form), output);
        assert.true(output.includes(REDACTED));
        assert.true(output.startsWith('{"error":"bad key '));
        assert.true(output.endsWith(' given"}'));
      });
    }

    test('removes a partial echo at the minimum length, in any case', function (assert) {
      let partial = KEY.slice(7, 7 + MIN_PARTIAL_LENGTH).toUpperCase();
      let output = scrubberFor(KEY).scrubText(`invalid key ending ${partial}.`);
      assert.strictEqual(output, `invalid key ending ${REDACTED}.`);
    });

    test('leaves a run shorter than the minimum alone', function (assert) {
      let short = KEY.slice(0, MIN_PARTIAL_LENGTH - 1);
      let text = `your key starts ${short}…`;
      assert.strictEqual(scrubberFor(KEY).scrubText(text), text);
    });

    test('removes a registered transform of the value', function (assert) {
      let basic = Buffer.from(`ci-bot:${KEY}`).toString('base64');
      let output = scrubberFor(KEY, basic).scrubText(
        `WWW-Authenticate refused: Basic ${basic}`,
      );
      assert.false(leaked(output, basic), output);
      assert.false(leaked(output, KEY), output);
    });

    test('scrubs every header value', function (assert) {
      let headers = scrubberFor(KEY).scrubHeaders(
        new Headers({
          location: `https://vendor.example/cb?key=${encodeURIComponent(KEY)}`,
          'x-echo': `Bearer ${KEY}`,
          'content-type': 'application/json',
        }),
      );
      assert.strictEqual(
        headers.get('location'),
        `https://vendor.example/cb?key=${REDACTED}`,
      );
      assert.strictEqual(headers.get('x-echo'), `Bearer ${REDACTED}`);
      assert.strictEqual(headers.get('content-type'), 'application/json');
    });

    test('catches a value split across chunks at any two boundaries', async function (assert) {
      let scrubber = scrubberFor(KEY);
      let body = Buffer.from(`{"echo":"${KEY}"}`);
      let failures: string[] = [];
      for (let first = 0; first <= body.length; first++) {
        for (let second = first; second <= body.length; second++) {
          let output = (
            await readAll(
              scrubber.scrubStream(
                streamOf([
                  body.subarray(0, first),
                  body.subarray(first, second),
                  body.subarray(second),
                ]),
              ),
            )
          ).toString();
          if (leaked(output, KEY) || !output.includes(REDACTED)) {
            failures.push(`${first}/${second}: ${output}`);
          }
        }
      }
      assert.deepEqual(failures, [], 'every split is scrubbed');
    });

    test('passes a body with no credential through byte for byte', async function (assert) {
      let scrubber = scrubberFor(KEY);
      let binary = randomBytes(256 * 1024);
      let chunks = [
        binary.subarray(0, 1000),
        binary.subarray(1000, 70_000),
        binary.subarray(70_000),
      ];
      let output = await readAll(scrubber.scrubStream(streamOf(chunks)));
      assert.true(output.equals(binary), 'binary is unchanged');

      let text = '{"a":"%zz \\\\u12 &#; &amp; \\u00e9t\\u00e9","b":"café"}';
      assert.strictEqual(
        scrubber.scrubText(text),
        text,
        'escapes that hide no credential are unchanged',
      );
    });

    test('delivers each event of a stream without waiting for the next', async function (assert) {
      let scrubber = scrubberFor(KEY);
      let event = `data: ${JSON.stringify({ id: 'gen-1', choices: [{ delta: { content: 'Hello' } }] })}\n\n`;
      let source = new TransformStream<Uint8Array, Uint8Array>();
      let writer = source.writable.getWriter();
      let reader = scrubber.scrubStream(source.readable).getReader();
      void writer.write(Buffer.from(event));
      let { value } = await reader.read();
      assert.strictEqual(
        Buffer.from(value!).toString(),
        event,
        'the whole event arrives before the stream continues',
      );
      void writer.close();
      assert.true((await reader.read()).done);
    });

    test('a stream that fails partway delivers none of what it held back', async function (assert) {
      let scrubber = scrubberFor(KEY);
      let prefix = `{"echo":"${KEY.slice(0, 20)}`;
      let source = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(Buffer.from(prefix));
          controller.error(new Error('response-too-large'));
        },
      });
      let reader = scrubber.scrubStream(source).getReader();
      let delivered = '';
      let failure: unknown;
      try {
        for (;;) {
          let { done, value } = await reader.read();
          if (done) break;
          delivered += Buffer.from(value!).toString();
        }
      } catch (error) {
        failure = error;
      }
      assert.strictEqual((failure as Error)?.message, 'response-too-large');
      assert.false(leaked(delivered, KEY), `delivered: ${delivered}`);
    });
  });

  module('through the outbound client', function (hooks) {
    let vendor: StubVendor;

    hooks.before(async function () {
      vendor = await startStubVendor();
    });
    hooks.after(async function () {
      await vendor.close();
    });
    hooks.beforeEach(function () {
      vendor.requests.length = 0;
      configureOutbound({ devAllowlist: ['127.0.0.1'] });
    });
    hooks.afterEach(function () {
      resetOutbound();
    });

    // Asks the stub vendor to answer as `spec` says, through the guarded
    // client with KEY (and `extra`) registered, and returns what the caller
    // reads along with everything logged meanwhile.
    async function planted(
      spec: StubVendorResponse,
      extra: string[] = [],
    ): Promise<{
      status: number;
      headers: Headers;
      body: Buffer;
      error?: unknown;
      logs: string[];
    }> {
      let status = 0;
      let headers = new Headers();
      let chunks: Uint8Array[] = [];
      let error: unknown;
      let logs = await logsDuring(['outbound'], async () => {
        let response = await outboundFetch({
          url: `${vendor.url}/respond`,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(spec),
          sizePath: 'call-api',
          scrubber: scrubberFor(KEY, ...extra),
        });
        status = response.status;
        headers = response.headers;
        let reader = response.body!.getReader();
        try {
          for (;;) {
            let { done, value } = await reader.read();
            if (done) break;
            chunks.push(value!);
          }
        } catch (e) {
          error = e;
        }
      });
      return { status, headers, body: Buffer.concat(chunks), error, logs };
    }

    function assertClean(
      assert: Assert,
      result: { headers: Headers; body: Buffer; logs: string[] },
      plantedForm: string,
    ) {
      let headerText = [...result.headers].map(([n, v]) => `${n}: ${v}`);
      assert.false(
        leaked(result.body.toString('latin1'), plantedForm),
        `body: ${result.body.toString('latin1').slice(0, 200)}`,
      );
      assert.false(
        leaked(headerText.join('\n'), plantedForm),
        `headers: ${headerText.join(', ')}`,
      );
      assert.false(
        leaked(result.logs.join('\n'), plantedForm),
        'no log line carries it',
      );
    }

    for (let [name, form] of Object.entries(encodedForms(KEY))) {
      test(`a body echoing the key ${name} reaches the caller without it`, async function (assert) {
        let result = await planted({
          headers: { 'content-type': 'application/json' },
          chunks: [`{"echo":"${form}"}`],
        });
        assertClean(assert, result, form);
        let body = result.body.toString();
        assert.true(body.includes(REDACTED));
        assert.true(
          body.startsWith('{"echo":"'),
          'what precedes the credential is untouched',
        );
        assert.true(
          body.endsWith('"}'),
          'what follows the credential is untouched',
        );
      });
    }

    test('a gzipped body is scrubbed after decompression', async function (assert) {
      let result = await planted({
        headers: { 'content-type': 'application/json' },
        chunks: [`{"echo":"${KEY.slice(0, 20)}`, `${KEY.slice(20)}"}`],
        gzip: true,
      });
      assertClean(assert, result, KEY);
      assert.strictEqual(result.body.toString(), `{"echo":"${REDACTED}"}`);
    });

    test('a key split across chunk boundaries is caught', async function (assert) {
      let result = await planted({
        chunks: [
          `{"padding":"${'x'.repeat(4000)}","echo":"${KEY.slice(0, 3)}`,
          KEY.slice(3, 25),
          `${KEY.slice(25)}"}`,
        ],
      });
      assertClean(assert, result, KEY);
      assert.true(result.body.toString().endsWith(`"echo":"${REDACTED}"}`));
    });

    test('a Location header carrying the key reaches the caller without it', async function (assert) {
      let result = await planted({
        status: 201,
        headers: {
          location: `https://vendor.example/items/1?api_key=${encodeURIComponent(KEY)}`,
          'x-request-echo': `Bearer ${KEY}`,
        },
        chunks: ['{}'],
      });
      assert.strictEqual(result.status, 201);
      assertClean(assert, result, KEY);
      assert.strictEqual(
        result.headers.get('location'),
        `https://vendor.example/items/1?api_key=${REDACTED}`,
      );
    });

    test('a partial echo inside an error response is removed', async function (assert) {
      let partial = KEY.slice(-12).toUpperCase();
      let result = await planted({
        status: 401,
        headers: { 'content-type': 'application/json' },
        chunks: [
          `{"error":{"message":"Incorrect API key provided: sk-****${partial}"}}`,
        ],
      });
      assert.strictEqual(result.status, 401);
      assertClean(assert, result, partial);
    });

    test('a registered Basic transform is removed in every form', async function (assert) {
      let basic = Buffer.from(`ci-bot:${KEY}`).toString('base64');
      let result = await planted(
        {
          status: 401,
          headers: { 'www-authenticate': `Basic realm="x", token="${basic}"` },
          chunks: [
            `{"received":"Basic ${basic}","escaped":"${encodeURIComponent(basic)}"}`,
          ],
        },
        [basic],
      );
      assertClean(assert, result, basic);
      assertClean(assert, result, encodeURIComponent(basic));
    });

    test('a body cut off partway delivers none of a credential it was holding', async function (assert) {
      let result = await planted({
        chunks: [`{"echo":"${KEY.slice(0, 20)}`],
        cutOff: true,
      });
      assert.ok(result.error, 'the caller sees the failure');
      assertClean(assert, result, KEY.slice(0, 20));
    });

    test('a response with no credential passes through byte for byte', async function (assert) {
      let binary = randomBytes(64 * 1024);
      let result = await planted({
        headers: {
          'content-type': 'application/octet-stream',
          'x-vendor': 'kept',
        },
        chunks: [
          [...binary.subarray(0, 1000)],
          [...binary.subarray(1000, 30_000)],
          [...binary.subarray(30_000)],
        ],
        gzip: true,
      });
      assert.true(result.body.equals(binary), 'the body is unchanged');
      assert.strictEqual(result.headers.get('x-vendor'), 'kept');
    });
  });
});
