import QUnit from 'qunit';
const { module, test } = QUnit;
import { basename } from 'path';
import jwt from 'jsonwebtoken';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PgAdapter } from '@cardstack/postgres';
import type {
  CaptureIdentity,
  DefinitionLookup,
  IndexWriter,
  Prerenderer,
  QueuePublisher,
  QueueRunner,
  Realm,
  CaptureRunPerfEvent,
  CapturePerfEvent,
  CapturePrerenderResponse,
  CaptureRequestPerfEvent,
  VirtualNetwork as VirtualNetworkType,
} from '@cardstack/runtime-common';
import {
  ANONYMOUS_RENDER,
  Deferred,
  MEDIA_CACHE_MAX_AGE_SECONDS,
  CAPTURE_PDF_MAX_BYTES,
  CAPTURE_PDF_MAX_PAGES,
  VirtualNetwork,
  asExpressions,
  canonicalCaptureIdentityQuery,
  canonicalCaptureIdentityString,
  captureContentDisposition,
  captureDispositionURL,
  captureSpecHash,
  checkPdfCaptureBounds,
  contentDispositionFor,
  declaredCaptureSpecHash,
  filenameFromContentDisposition,
  sanitizeCaptureFilename,
  takeCaptureDispositionParams,
  countPdfPages,
  findMediaCacheEntry,
  pdfFilenameFor,
  insert,
  logger,
  parseCaptureSpecParams,
  parseCaptureRequestSpec,
  putMedia,
  REALM_AUTHORITY_RENDER,
  revokeUserSessions,
  query,
  capture,
  setCapturePerfSink,
} from '@cardstack/runtime-common';

import Koa from 'koa';
import Router from '@koa/router';
import supertest from 'supertest';
import type { MatrixClient } from '@cardstack/runtime-common/matrix-client';

import { enqueueCaptureJob } from '@cardstack/runtime-common/jobs/capture';
import handleCapture from '../handlers/handle-capture.ts';
import type { CreateRoutesArgs } from '../routes.ts';
import { jwtMiddleware } from '../middleware/index.ts';
import { createJWT } from '../utils/jwt.ts';
import { FakeMediaCacheAdapter } from './helpers/fake-media-cache-adapter.ts';
import {
  createRealm,
  insertJob,
  realmSecretSeed,
  setupDB,
} from './helpers/index.ts';
import { nodeStreamToBuffer } from '../stream.ts';

const REALM_URL = 'http://test-dsl-realm/';
const OWNER = '@node-test_realm:localhost';
const PNG_BYTES = new TextEncoder().encode('stub-png-bytes');
const PNG_BASE64 = Buffer.from(PNG_BYTES).toString('base64');
const PDF_BYTES = new TextEncoder().encode('%PDF-stub-bytes');
const PDF_BASE64 = Buffer.from(PDF_BYTES).toString('base64');
// Long enough that a healthy queue round-trip never times out; short enough
// that the deliberately-stalled timeout test doesn't drag the suite.
const SYNC_WAIT_MS = 2000;

function params(qs: string): URLSearchParams {
  return new URL(`http://x/?${qs}`).searchParams;
}

module(basename(import.meta.filename), function () {
  module('capture-spec canonicalization', function () {
    test('the all-defaults spec canonicalizes to {} however it is spelled', async function (assert) {
      let bare = parseCaptureSpecParams(params(''));
      let explicit = parseCaptureSpecParams(params('format=isolated'));
      assert.true('spec' in bare, 'the bare URL parses');
      assert.true('spec' in explicit, 'the explicit-default URL parses');
      if ('spec' in bare && 'spec' in explicit) {
        assert.strictEqual(canonicalCaptureIdentityString(bare.spec), '{}');
        assert.strictEqual(
          await captureSpecHash(bare.spec),
          await captureSpecHash(explicit.spec),
          'default-elision makes the two spellings one cache key',
        );
      }
    });

    test('a non-default format is its own cache key', async function (assert) {
      let embedded = parseCaptureSpecParams(params('format=embedded'));
      assert.true('spec' in embedded, 'format=embedded parses');
      if ('spec' in embedded) {
        assert.strictEqual(
          canonicalCaptureIdentityString(embedded.spec),
          '{"format":"embedded"}',
        );
        assert.notStrictEqual(
          await captureSpecHash(embedded.spec),
          await captureSpecHash({ format: 'isolated' }),
        );
      }
    });

    test('every spelling of one capture geometry is one cache key', async function (assert) {
      // Explicit engine defaults are elided: this URL means the bare URL.
      let explicitDefaults = parseCaptureSpecParams(
        params('viewport=800x600&dsf=1&fullPage=false'),
      );
      assert.true('spec' in explicitDefaults, 'explicit defaults parse');
      if ('spec' in explicitDefaults) {
        assert.strictEqual(
          canonicalCaptureIdentityString(explicitDefaults.spec),
          '{}',
        );
      }

      // Numeric spellings normalize: 2.0 and 2 are the same scale.
      let dsfInt = parseCaptureSpecParams(params('dsf=2'));
      let dsfDecimal = parseCaptureSpecParams(params('dsf=2.0'));
      if ('spec' in dsfInt && 'spec' in dsfDecimal) {
        assert.strictEqual(
          await captureSpecHash(dsfInt.spec),
          await captureSpecHash(dsfDecimal.spec),
          'dsf=2 and dsf=2.0 are one cache key',
        );
      }

      // The GET grammar and the POST body express one identity: parsing
      // either surface's spelling of a capture hashes identically.
      let viaGet = parseCaptureSpecParams(
        params('viewport=1280x800&dsf=2&format=embedded'),
      );
      let viaPost = parseCaptureRequestSpec(
        {
          viewport: { width: 1280, height: 800 },
          deviceScaleFactor: 2,
        },
        'embedded',
      );
      assert.true('spec' in viaGet, 'the GET spelling parses');
      assert.strictEqual(viaPost.error, undefined, 'the POST spelling parses');
      if ('spec' in viaGet && !viaPost.error) {
        assert.strictEqual(
          await captureSpecHash(viaGet.spec),
          await captureSpecHash({
            format: 'embedded',
            ...(viaPost.captureSpec ?? {}),
          }),
          'GET params and POST body canonicalize to one hash',
        );
      }
    });

    test('the canonical served query round-trips through the parser', async function (assert) {
      let specs: Parameters<typeof canonicalCaptureIdentityQuery>[0][] = [
        { format: 'isolated' },
        { format: 'embedded', viewport: { width: 1280, height: 800 } },
        { format: 'isolated', deviceScaleFactor: 1.5, fullPage: true },
        {
          format: 'isolated',
          viewport: { width: 1280, height: 800 },
          clip: { x: 0.5, y: 10, width: 400, height: 300 },
        },
        // A clip offset whose String form is scientific notation: the
        // validator admits any non-negative finite x/y, so the URL grammar
        // must reparse every spelling `String` can emit for them.
        {
          format: 'isolated',
          clip: { x: 1e-7, y: 0, width: 400, height: 300 },
        },
        // Default-valued fields must vanish from the query entirely.
        {
          format: 'isolated',
          viewport: { width: 800, height: 600 },
          deviceScaleFactor: 1,
          fullPage: false,
        },
        // A pdf spec's served URL must reparse on the GET surface, since the
        // ledger serves it there.
        { format: 'isolated', type: 'pdf' },
      ];
      for (let spec of specs) {
        let queryString = canonicalCaptureIdentityQuery(spec);
        let reparsed = parseCaptureSpecParams(
          new URL(`http://x/${queryString}`).searchParams,
        );
        assert.true(
          'spec' in reparsed,
          `"${queryString}" reparses (${JSON.stringify(spec)})`,
        );
        if ('spec' in reparsed) {
          assert.strictEqual(
            canonicalCaptureIdentityString(reparsed.spec),
            canonicalCaptureIdentityString(spec),
            `"${queryString}" round-trips to the same canonical form`,
          );
        }
      }
    });

    test('the served query spells the documented grammar, commas unescaped', function (assert) {
      // The emitted URL must read as the same grammar the params document
      // and the 400 messages teach — `URLSearchParams` would percent-encode
      // the clip commas into `clip=0%2C0%2C400x300`.
      assert.strictEqual(
        canonicalCaptureIdentityQuery({
          format: 'embedded',
          viewport: { width: 1280, height: 800 },
          deviceScaleFactor: 2,
          clip: { x: 0, y: 10, width: 400, height: 300 },
        }),
        '?format=embedded&viewport=1280x800&dsf=2&clip=0,10,400x300',
      );
      assert.strictEqual(
        canonicalCaptureIdentityQuery({ format: 'isolated', fullPage: true }),
        '?fullPage=true',
      );
    });

    test('errors name the offending field', function (assert) {
      let unknown = parseCaptureSpecParams(params('sparkle=true'));
      assert.deepEqual(unknown, {
        error: { field: 'sparkle', message: 'unsupported parameter "sparkle"' },
      });

      let reserved = parseCaptureSpecParams(params('envelope=fitted'));
      assert.deepEqual(reserved, {
        error: {
          field: 'envelope',
          message:
            'parameter "envelope" is not supported by this capture engine',
        },
      });

      let badFormat = parseCaptureSpecParams(params('format=fancy'));
      assert.deepEqual(badFormat, {
        error: {
          field: 'format',
          message: 'format must be "isolated" or "embedded"',
        },
      });

      let repeated = parseCaptureSpecParams(
        params('format=isolated&format=embedded'),
      );
      assert.strictEqual(
        'error' in repeated ? repeated.error.field : undefined,
        'format',
      );
    });

    test('malformed geometry values are refused naming the param', function (assert) {
      for (let [qs, field] of [
        ['viewport=huge', 'viewport'],
        ['viewport=1280', 'viewport'],
        ['dsf=fast', 'dsf'],
        ['fullPage=1', 'fullPage'],
        ['clip=0,0', 'clip'],
        ['clip=-1,0,400x300', 'clip'],
        ['viewport=1280x800&viewport=640x480', 'viewport'],
      ] as const) {
        let parsed = parseCaptureSpecParams(params(qs));
        assert.strictEqual(
          'error' in parsed ? parsed.error.field : undefined,
          field,
          `"${qs}" is refused naming ${field}`,
        );
      }
    });

    test('out-of-range geometry is refused with the POST wording', function (assert) {
      for (let [qs, field, message] of [
        [
          'viewport=5000x100',
          'viewport',
          'captureSpec.viewport.width must be <= 4096',
        ],
        [
          'viewport=100x20000',
          'viewport',
          'captureSpec.viewport.height must be <= 16384',
        ],
        ['dsf=5', 'dsf', 'captureSpec.deviceScaleFactor must be <= 3'],
        [
          'dsf=0',
          'dsf',
          'captureSpec.deviceScaleFactor must be a positive number',
        ],
        [
          'fullPage=true&clip=0,0,400x300',
          'fullPage',
          'captureSpec cannot set both fullPage and clip',
        ],
        [
          'viewport=200x200&clip=0,0,400x300',
          'clip',
          'captureSpec.clip exceeds the viewport width',
        ],
        [
          'viewport=100x16384&dsf=2',
          'viewport',
          'captureSpec.viewport.height × deviceScaleFactor must be <= 16384 physical pixels',
        ],
      ] as const) {
        let parsed = parseCaptureSpecParams(params(qs));
        assert.deepEqual(
          'error' in parsed ? parsed.error : undefined,
          { field, message },
          `"${qs}" is refused with the shared-validator wording`,
        );
      }
    });

    test('explicit default type and media elide like the other engine defaults', async function (assert) {
      let explicit = parseCaptureSpecParams(params('type=png&media=screen'));
      assert.true('spec' in explicit, 'the explicit-default spelling parses');
      if ('spec' in explicit) {
        assert.strictEqual(canonicalCaptureIdentityString(explicit.spec), '{}');
        assert.strictEqual(
          await captureSpecHash(explicit.spec),
          await captureSpecHash({ format: 'isolated' }),
          'type=png&media=screen means the bare canonical capture',
        );
      }
    });

    test('not-yet-supported output types and media are refused naming the param', function (assert) {
      for (let [qs, field, message] of [
        [
          'type=jpeg',
          'type',
          'captureSpec.type "jpeg" is not supported by this capture engine',
        ],
        [
          'type=gif',
          'type',
          'captureSpec.type must be one of png/jpeg/webp/pdf',
        ],
        [
          'media=braille',
          'media',
          'captureSpec.media must be one of screen/print',
        ],
      ] as const) {
        let parsed = parseCaptureSpecParams(params(qs));
        assert.deepEqual(
          'error' in parsed ? parsed.error : undefined,
          { field, message },
          `"${qs}" is refused naming ${field}`,
        );
      }

      // The POST body runs the same engine gate with the same wording.
      let viaPost = parseCaptureRequestSpec({ type: 'jpeg' }, 'isolated');
      assert.strictEqual(
        viaPost.error,
        'captureSpec.type "jpeg" is not supported by this capture engine',
      );
    });

    test('media=print parses and round-trips on both surfaces', function (assert) {
      // The engine emulates print media across the settle, so `print` parses,
      // carries into the identity, and round-trips back to the same canonical
      // query on both surfaces.
      let viaGet = parseCaptureSpecParams(params('media=print'));
      assert.true('spec' in viaGet, 'media=print parses on the GET surface');
      if ('spec' in viaGet) {
        assert.strictEqual(
          canonicalCaptureIdentityString(viaGet.spec),
          '{"media":"print"}',
        );
        assert.strictEqual(
          canonicalCaptureIdentityQuery(viaGet.spec),
          '?media=print',
        );
      }

      let viaPost = parseCaptureRequestSpec({ media: 'print' }, 'isolated');
      assert.deepEqual(
        viaPost.captureSpec,
        { media: 'print' },
        'media=print parses on the POST surface, carrying the axis',
      );
    });

    test('a batch may not mix media values', function (assert) {
      // Media emulation is page-level and a batch settles once, so every entry
      // renders under one media — a mixed-media batch is refused, not silently
      // rendered with the later entries under the wrong media.
      let mixed = parseCaptureRequestSpec(
        {
          media: 'print',
          captures: [{ name: 'a' }, { name: 'b', media: 'screen' }],
        },
        'isolated',
      );
      assert.strictEqual(
        mixed.error,
        'captureSpec.captures may not mix media values',
      );

      // A uniform batch (the batch-wide default alone) is fine.
      let uniform = parseCaptureRequestSpec(
        { media: 'print', captures: [{ name: 'a' }, { name: 'b' }] },
        'isolated',
      );
      assert.strictEqual(
        uniform.error,
        undefined,
        'a uniform-media batch parses',
      );
    });

    test('pdf output parses on the POST surface, singular-only', function (assert) {
      let singular = parseCaptureRequestSpec({ type: 'pdf' }, 'isolated');
      assert.strictEqual(singular.error, undefined, 'a singular pdf parses');
      assert.deepEqual(
        singular.captureSpec,
        { type: 'pdf' },
        'the normalized spec carries the encoding',
      );

      // Raster geometry is a contradiction, not a composition: crop modes
      // because pagination cannot honor them, viewport because `page.pdf()`
      // lays the document out at paper width — admitting it would mint
      // distinct ledger identities over byte-identical documents.
      for (let [raw, message] of [
        [
          { type: 'pdf', fullPage: true },
          'captureSpec cannot set both type "pdf" and fullPage',
        ],
        [
          { type: 'pdf', clip: { x: 0, y: 0, width: 100, height: 100 } },
          'captureSpec cannot set both type "pdf" and clip',
        ],
        [
          { type: 'pdf', target: '.avatar' },
          'captureSpec cannot set both type "pdf" and target',
        ],
        [
          { type: 'pdf', viewport: { width: 1280, height: 800 } },
          'captureSpec cannot set both type "pdf" and viewport',
        ],
        [
          { captures: [{ name: 'doc', type: 'pdf' }] },
          'captureSpec.captures[0].type "pdf" is only valid on a singular capture',
        ],
      ] as const) {
        assert.strictEqual(
          parseCaptureRequestSpec(raw, 'isolated').error,
          message,
        );
      }

      // A viewport spelling the engine default elides to the same canonical
      // form as omitting it, so it stays admitted — equivalent spellings must
      // behave identically.
      let defaultViewport = parseCaptureRequestSpec(
        { type: 'pdf', viewport: { width: 800, height: 600 } },
        'isolated',
      );
      assert.strictEqual(defaultViewport.error, undefined);
      assert.deepEqual(
        defaultViewport.captureSpec,
        { type: 'pdf' },
        'the default-valued viewport elides away',
      );
    });

    test('countPdfPages counts page objects, with the page-tree count as a floor', function (assert) {
      let pdfWith = (body: string) =>
        new TextEncoder().encode(`%PDF-1.4\n${body}\n%%EOF`);
      assert.strictEqual(
        countPdfPages(
          pdfWith(
            '1 0 obj << /Type /Pages /Kids [2 0 R 3 0 R] /Count 2 >> endobj\n' +
              '2 0 obj << /Type /Page /Parent 1 0 R >> endobj\n' +
              '3 0 obj << /Type /Page /Parent 1 0 R >> endobj',
          ),
        ),
        2,
        'counts uncompressed page dictionaries',
      );
      assert.strictEqual(
        countPdfPages(pdfWith('1 0 obj << /Type /Pages /Count 7 >> endobj')),
        7,
        'falls back to the page-tree /Count when page objects are compressed away',
      );
      assert.strictEqual(
        countPdfPages(pdfWith('')),
        0,
        'no page markers means zero, never a guess',
      );
    });

    test('checkPdfCaptureBounds enforces the byte and page caps by name', function (assert) {
      let pagesPdf = (count: number) =>
        new TextEncoder().encode(
          `%PDF-1.4\n1 0 obj << /Type /Pages /Count ${count} >> endobj\n%%EOF`,
        );

      let within = checkPdfCaptureBounds('doc', pagesPdf(3));
      assert.strictEqual(within.error, undefined, 'within both caps');
      assert.strictEqual(within.pageCount, 3, 'reports the page count');

      let atPageCap = checkPdfCaptureBounds(
        'doc',
        pagesPdf(CAPTURE_PDF_MAX_PAGES),
      );
      assert.strictEqual(
        atPageCap.error,
        undefined,
        'the cap itself is within bounds',
      );

      let overPages = checkPdfCaptureBounds(
        'doc',
        pagesPdf(CAPTURE_PDF_MAX_PAGES + 1),
      );
      assert.strictEqual(
        overPages.error,
        `pdf capture "doc" produced ${CAPTURE_PDF_MAX_PAGES + 1} pages, over the ${CAPTURE_PDF_MAX_PAGES}-page cap`,
        'over the page cap is an error naming the cap',
      );

      let overBytes = checkPdfCaptureBounds(
        'doc',
        new Uint8Array(CAPTURE_PDF_MAX_BYTES + 1),
      );
      assert.strictEqual(
        overBytes.error,
        `pdf capture "doc" produced ${CAPTURE_PDF_MAX_BYTES + 1} bytes, over the ${CAPTURE_PDF_MAX_BYTES}-byte cap`,
        'over the byte cap is an error naming the cap',
      );

      let atByteCap = checkPdfCaptureBounds(
        'doc',
        new Uint8Array(CAPTURE_PDF_MAX_BYTES),
      );
      assert.strictEqual(
        atByteCap.error,
        undefined,
        'the byte cap itself is within bounds',
      );
    });

    test('pdfFilenameFor names the download after the source card', function (assert) {
      assert.strictEqual(
        pdfFilenameFor('http://realm.test/demo/Person/fadhlan'),
        'fadhlan.pdf',
      );
      assert.strictEqual(
        pdfFilenameFor('http://realm.test/demo/docs/report.pdf'),
        'report.pdf',
        'an existing pdf extension is not doubled',
      );
      assert.strictEqual(
        pdfFilenameFor('http://realm.test/demo/Meeting%20Notes'),
        'Meeting-20Notes.pdf',
        'quoted-string-unsafe characters are collapsed',
      );
    });

    test('sanitizeCaptureFilename reduces a requested name to one safe component', function (assert) {
      assert.strictEqual(
        sanitizeCaptureFilename('Q3 Statement', 'pdf'),
        'Q3 Statement.pdf',
      );
      assert.strictEqual(
        sanitizeCaptureFilename('Q3 Statement.PDF', 'pdf'),
        'Q3 Statement.pdf',
        'an existing extension is not doubled, whatever its case',
      );
      assert.strictEqual(
        sanitizeCaptureFilename('a\r\nSet-Cookie: x=1', 'pdf'),
        'a Set-Cookie: x=1.pdf',
        'CR/LF never survive into a header value',
      );
      assert.strictEqual(
        sanitizeCaptureFilename('../../etc/passwd', 'pdf'),
        '-..-etc-passwd.pdf',
        'path separators become dashes and leading dots are dropped',
      );
      assert.strictEqual(
        sanitizeCaptureFilename('Relevé de compte', 'pdf'),
        'Relevé de compte.pdf',
        'non-ASCII survives',
      );
      assert.strictEqual(
        sanitizeCaptureFilename('x'.repeat(500), 'pdf'),
        `${'x'.repeat(120)}.pdf`,
        'the stem is capped in code points',
      );
      assert.strictEqual(
        sanitizeCaptureFilename('報'.repeat(200), 'pdf'),
        `${'報'.repeat(80)}.pdf`,
        'and in UTF-8 bytes, so a 3-byte script stops at 240 bytes',
      );
      let halfEmoji = 'Trip \u{1F3D6} notes'.slice(0, 6);
      assert.strictEqual(
        sanitizeCaptureFilename(halfEmoji, 'pdf'),
        'Trip \uFFFD.pdf',
        'a lone surrogate becomes U+FFFD',
      );
      assert.strictEqual(
        captureContentDisposition({
          attachment: false,
          filename: sanitizeCaptureFilename(halfEmoji, 'pdf')!,
        }),
        `inline; filename="Trip _.pdf"; filename*=UTF-8''Trip%20%EF%BF%BD.pdf`,
        'and the name still encodes',
      );
      assert.strictEqual(sanitizeCaptureFilename('  \n ', 'pdf'), undefined);
      assert.strictEqual(sanitizeCaptureFilename('.pdf', 'pdf'), undefined);
    });

    test('captureContentDisposition sends an ASCII fallback and an exact UTF-8 name when they differ', function (assert) {
      assert.strictEqual(
        captureContentDisposition({
          attachment: false,
          filename: 'Q3 Statement.pdf',
        }),
        'inline; filename="Q3 Statement.pdf"',
        'a plain ASCII name needs no filename*',
      );
      assert.strictEqual(
        captureContentDisposition({
          attachment: true,
          filename: 'Relevé — Q3.pdf',
        }),
        `attachment; filename="Releve _ Q3.pdf"; filename*=UTF-8''Relev%C3%A9%20%E2%80%94%20Q3.pdf`,
      );
      assert.strictEqual(
        captureContentDisposition({
          attachment: false,
          filename: `Bob's "100%" (final).pdf`,
        }),
        `inline; filename="Bob's _100__ (final).pdf"; filename*=UTF-8''Bob%27s%20%22100%25%22%20%28final%29.pdf`,
        'quotes, backslashes and percent signs stay out of the quoted string',
      );
    });

    test('filenameFromContentDisposition reads back what captureContentDisposition writes', function (assert) {
      for (let filename of [
        'Q3 Statement.pdf',
        'Relevé — Q3.pdf',
        `Bob's "100%" (final).pdf`,
        '報告書.pdf',
      ]) {
        assert.strictEqual(
          filenameFromContentDisposition(
            captureContentDisposition({ attachment: true, filename }),
          ),
          filename,
        );
      }
      assert.strictEqual(
        filenameFromContentDisposition('attachment; filename=plain.pdf'),
        'plain.pdf',
      );
      assert.strictEqual(
        filenameFromContentDisposition(
          captureContentDisposition({
            attachment: true,
            filename: `a; filename*=UTF-8''evil.pdf`,
          }),
        ),
        `a; filename*=UTF-8''evil.pdf`,
        'text inside the quoted name is never read as a parameter',
      );
      assert.strictEqual(filenameFromContentDisposition('inline'), undefined);
      assert.strictEqual(filenameFromContentDisposition(null), undefined);
    });

    test('takeCaptureDispositionParams removes the disposition params and reads them', function (assert) {
      let searchParams = params('name=statement&download&filename=Q3');
      let parsed = takeCaptureDispositionParams(searchParams);
      assert.deepEqual(parsed, {
        disposition: { attachment: true, filename: 'Q3' },
      });
      assert.strictEqual(
        searchParams.toString(),
        'name=statement',
        'only the addressing remains',
      );

      assert.deepEqual(takeCaptureDispositionParams(params('download=0')), {
        disposition: { attachment: false },
      });
      assert.deepEqual(takeCaptureDispositionParams(params('type=pdf')), {
        disposition: { attachment: false },
      });
      let bad = takeCaptureDispositionParams(params('download=yes'));
      assert.deepEqual(bad, {
        error: {
          field: 'download',
          message: 'download must be "1", "true", "0", or "false"',
        },
      });
      let repeated = takeCaptureDispositionParams(
        params('filename=a&filename=b'),
      );
      assert.deepEqual(repeated, {
        error: {
          field: 'filename',
          message: 'filename may only be given once',
        },
      });
    });

    test('captureDispositionURL sets the disposition params, replacing any already present', function (assert) {
      assert.strictEqual(
        captureDispositionURL(
          'http://realm.test/_capture/card-1?name=statement&filename=old',
          { attachment: true, filename: ' Q3 Statement ' },
        ),
        'http://realm.test/_capture/card-1?name=statement&download=1&filename=Q3+Statement',
      );
      assert.strictEqual(
        captureDispositionURL(
          'http://realm.test/_capture/card-1?type=pdf&download=1',
          { attachment: false, filename: '' },
        ),
        'http://realm.test/_capture/card-1?type=pdf',
      );
    });

    test('contentDispositionFor prefers the request, then the declaration, then the source URL', function (assert) {
      let pdf = {
        contentType: 'application/pdf',
        sourceURL: 'http://realm.test/demo/Statement/4884f71e',
      };
      assert.strictEqual(
        contentDispositionFor({ entry: pdf }),
        'inline; filename="4884f71e.pdf"',
      );
      assert.strictEqual(
        contentDispositionFor({ entry: pdf, declaredFilename: 'Acme Q3' }),
        'inline; filename="Acme Q3.pdf"',
      );
      assert.strictEqual(
        contentDispositionFor({
          entry: pdf,
          declaredFilename: 'Acme Q3',
          disposition: { attachment: true, filename: 'Mine' },
        }),
        'attachment; filename="Mine.pdf"',
      );
      assert.strictEqual(
        contentDispositionFor({
          entry: pdf,
          declaredFilename: 'Acme Q3',
          disposition: { attachment: false, filename: '\n' },
        }),
        'inline; filename="Acme Q3.pdf"',
        'a requested name that sanitizes to nothing falls through',
      );

      let png = {
        contentType: 'image/png',
        sourceURL: 'http://realm.test/demo/Statement/4884f71e',
      };
      assert.strictEqual(
        contentDispositionFor({ entry: png }),
        undefined,
        'an image carries no disposition unless asked',
      );
      assert.strictEqual(
        contentDispositionFor({
          entry: png,
          disposition: { attachment: true },
        }),
        'attachment; filename="4884f71e.png"',
      );
    });

    test('a declared filename is not part of the capture identity', async function (assert) {
      assert.strictEqual(
        await declaredCaptureSpecHash('statement', {
          format: 'isolated',
          type: 'pdf',
          filename: 'Acme Q3',
        }),
        await declaredCaptureSpecHash('statement', {
          format: 'isolated',
          type: 'pdf',
        }),
      );
    });

    test('output type and media are identity axes: each non-default value is its own cache key', async function (assert) {
      // Constructed directly rather than parsed: this pins the identity layer
      // itself — each non-default axis value keys its own capture —
      // independently of which parse surfaces admit a value, so gating or
      // unlocking a value at a surface never re-keys existing captures.
      let png: CaptureIdentity = { format: 'isolated' };
      let pdf: CaptureIdentity = { format: 'isolated', type: 'pdf' };
      let print: CaptureIdentity = { format: 'isolated', media: 'print' };
      assert.strictEqual(canonicalCaptureIdentityString(pdf), '{"type":"pdf"}');
      assert.strictEqual(
        canonicalCaptureIdentityString(print),
        '{"media":"print"}',
      );
      assert.strictEqual(canonicalCaptureIdentityQuery(pdf), '?type=pdf');
      assert.strictEqual(canonicalCaptureIdentityQuery(print), '?media=print');
      let hashes = await Promise.all([
        captureSpecHash(png),
        captureSpecHash(pdf),
        captureSpecHash(print),
      ]);
      assert.strictEqual(
        new Set(hashes).size,
        3,
        'png, pdf, and print-media captures are three distinct cache keys',
      );
    });
  });

  module('GET _capture flow', function (hooks) {
    let dbAdapter: PgAdapter;
    let publisher: QueuePublisher;
    let runner: QueueRunner;
    let realm: Realm;
    let adapter: FakeMediaCacheAdapter;
    let virtualNetwork: VirtualNetworkType;
    let captureCalls: number;
    // The captureSpec each stub render received, so tests can assert the
    // parsed geometry actually reaches the capture engine.
    let capturedSpecs: unknown[];
    // The renderOptions each stub render received, so tests can assert which
    // rendering (card or file) a capture went through.
    let capturedRenderOptions: unknown[];
    // When set, in-flight captures park on it — the lever for the sync-wait
    // timeout test.
    let captureGate: Deferred<void> | undefined;
    // When set, captures throw it — the lever for the job-rejection error
    // test.
    let captureFailure: Error | undefined;
    // Telemetry captured through the perf sink instead of the log channel,
    // so tests assert on records, not stdout.
    let perfEvents: CapturePerfEvent[];

    hooks.beforeEach(function () {
      perfEvents = [];
      setCapturePerfSink((event) => perfEvents.push(event));
    });
    hooks.afterEach(function () {
      setCapturePerfSink(undefined);
    });

    setupDB(hooks, {
      beforeEach: async (
        _dbAdapter: PgAdapter,
        _publisher: QueuePublisher,
        _runner: QueueRunner,
      ): Promise<void> => {
        dbAdapter = _dbAdapter;
        publisher = _publisher;
        runner = _runner;
        adapter = new FakeMediaCacheAdapter();
        captureCalls = 0;
        capturedSpecs = [];
        capturedRenderOptions = [];
        captureGate = undefined;
        captureFailure = undefined;
        virtualNetwork = new VirtualNetwork();
        ({ realm } = await createRealm({
          dir: await mkdtemp(join(tmpdir(), 'media-cache-dsl-test-')),
          definitionLookup: {
            forRealm() {
              return this;
            },
          } as unknown as DefinitionLookup,
          realmURL: REALM_URL,
          permissions: {
            '*': ['read'],
            [OWNER]: ['read', 'write', 'realm-owner'],
          },
          virtualNetwork,
          publisher,
          dbAdapter,
          mediaCacheAdapter: adapter,
          captureSyncWaitMs: SYNC_WAIT_MS,
        }));
      },
    });

    // Registers the real capture task on the test runner, with a
    // stub prerenderer standing in for the Chrome pool. Only tests that
    // want a capture to complete start the worker; the rest leave enqueued
    // jobs unclaimed on purpose. `prerenderResult` swaps in a non-ready
    // outcome so a test can exercise the render-failure path.
    async function startWorker(
      prerenderResult?: () => CapturePrerenderResponse,
    ) {
      let prerenderer = {
        prerenderCapture: async (args: {
          captureSpec?: unknown;
          renderOptions?: unknown;
        }): Promise<CapturePrerenderResponse> => {
          captureCalls++;
          capturedSpecs.push(args.captureSpec ?? null);
          capturedRenderOptions.push(args.renderOptions ?? null);
          if (captureGate) {
            await captureGate.promise;
          }
          if (captureFailure) {
            throw captureFailure;
          }
          if (prerenderResult) {
            return prerenderResult();
          }
          // Echo the requested encoding the way the real engine does: a pdf
          // spec produces paged bytes with no pixel dimensions.
          if (
            (args.captureSpec as { type?: string } | undefined)?.type === 'pdf'
          ) {
            return {
              status: 'ready',
              base64: PDF_BASE64,
              contentType: 'application/pdf',
              captures: [
                {
                  name: 'default',
                  base64: PDF_BASE64,
                  deviceScaleFactor: 1,
                  pageCount: 1,
                },
              ],
              meta: { requestId: 'stub-prerender-req' },
            };
          }
          return {
            status: 'ready',
            base64: PNG_BASE64,
            width: 8,
            height: 6,
            contentType: 'image/png',
            // The shape the real prerenderer attaches: an HTTP request id
            // plus the timing diagnostics block, so the telemetry tests can
            // assert the task lifts every stage into its capture record.
            meta: {
              requestId: 'stub-prerender-req',
              diagnostics: {
                launchMs: 5,
                waits: { semaphoreMs: 1 },
                renderElapsedMs: 20,
                tabReused: true,
                captureNavMs: 4,
                captureSettleMs: 6,
                captureImagePaintMs: 7,
                cdpCaptureMs: 3,
              },
            },
          };
        },
      } as unknown as Prerenderer;
      await runner.register(
        'capture',
        capture({
          dbAdapter,
          queuePublisher: publisher,
          prerenderer,
          mediaCacheAdapter: adapter,
          log: logger('media-cache-dsl-test'),
          reportStatus: () => {},
          matrixURL: 'http://localhost:8008',
          indexWriter: null as unknown as IndexWriter,
          definitionLookup: null as unknown as DefinitionLookup,
          virtualNetwork,
          getReader: () => {
            throw new Error('getReader is not used by capture');
          },
          getAuthedFetch: async () => globalThis.fetch,
          createPrerenderAuth: () => 'test-auth',
        }),
      );
      await runner.start();
    }

    async function seedInstanceRow(localPath: string, generation = 1) {
      let { nameExpressions, valueExpressions } = asExpressions(
        {
          url: `${REALM_URL}${localPath}.json`,
          file_alias: `${REALM_URL}${localPath}`,
          realm_url: REALM_URL,
          type: 'instance',
          generation,
          last_modified: Date.now(),
          resource_created_at: Date.now(),
          is_deleted: false,
          pristine_doc: { attributes: {} },
        },
        { jsonFields: ['pristine_doc'] },
      );
      await query(
        dbAdapter,
        insert('boxel_index', nameExpressions, valueExpressions),
      );
    }

    // A file's own index row, keyed by its extension-intact URL. `alias`
    // defaults to that URL; a `.json` file's row carries the extensionless id.
    async function seedFileRow(
      localPath: string,
      { generation = 1, alias }: { generation?: number; alias?: string } = {},
    ) {
      let { nameExpressions, valueExpressions } = asExpressions(
        {
          url: `${REALM_URL}${localPath}`,
          file_alias: alias ?? `${REALM_URL}${localPath}`,
          realm_url: REALM_URL,
          type: 'file',
          generation,
          last_modified: Date.now(),
          resource_created_at: Date.now(),
          is_deleted: false,
          pristine_doc: { attributes: {} },
        },
        { jsonFields: ['pristine_doc'] },
      );
      await query(
        dbAdapter,
        insert('boxel_index', nameExpressions, valueExpressions),
      );
    }

    // Seeds the `prerendered_html` manifest row the `?name=` route and the
    // card+json `meta.captures` join read — the artifact the prerender
    // pass persists via `updatePrerenderedHtmlEntry`.
    async function seedManifestRow(
      localPath: string,
      captures: Record<string, unknown>,
      generation = 1,
    ) {
      let { nameExpressions, valueExpressions } = asExpressions(
        {
          url: `${REALM_URL}${localPath}.json`,
          file_alias: `${REALM_URL}${localPath}`,
          realm_url: REALM_URL,
          type: 'instance',
          generation,
          captures,
        },
        { jsonFields: ['captures'] },
      );
      await query(
        dbAdapter,
        insert('prerendered_html', nameExpressions, valueExpressions),
      );
    }

    async function seedRealmConfigRow(
      allowArbitraryCaptures: boolean,
      key = 'allowArbitraryCaptures',
    ) {
      let { nameExpressions, valueExpressions } = asExpressions(
        {
          url: `${REALM_URL}realm.json`,
          file_alias: `${REALM_URL}realm`,
          realm_url: REALM_URL,
          type: 'instance',
          generation: 1,
          last_modified: Date.now(),
          resource_created_at: Date.now(),
          is_deleted: false,
          pristine_doc: { attributes: { [key]: allowArbitraryCaptures } },
        },
        { jsonFields: ['pristine_doc'] },
      );
      await query(
        dbAdapter,
        insert('boxel_index', nameExpressions, valueExpressions),
      );
    }

    // A realm session for `user`, which a reader presents on the GET route.
    function realmSession(user: string) {
      return realm.createJWT(
        {
          user,
          realm: realm.url,
          permissions: ['read', 'write', 'realm-owner'],
          sessionRoom: `session-room-for-${user}`,
          realmServerURL: realm.realmServerURL,
        },
        '1d',
      );
    }

    // A realm session issued a minute ago, so a revocation recorded now
    // postdates it.
    function craftSession(claims: Record<string, unknown>) {
      let iat = Math.floor(Date.now() / 1000) - 60;
      return jwt.sign(
        {
          sessionRoom: 'session-room',
          realmServerURL: realm.realmServerURL,
          ...claims,
          iat,
          exp: iat + 900,
        },
        realmSecretSeed,
      );
    }

    async function seedCaptureDrawnAs(renderedAs: string) {
      await putMedia(dbAdapter, adapter, {
        renderedAs,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: await captureSpecHash({ format: 'isolated' }),
        sourceGeneration: 1,
        bytes: PNG_BYTES,
        contentType: 'image/png',
        lane: 'on-demand',
      });
    }

    async function get(
      pathAndQuery: string,
      method = 'GET',
      headers: Record<string, string> = {},
    ) {
      let response = await realm.handle(
        new Request(`${REALM_URL}${pathAndQuery}`, { method, headers }),
      );
      return response!;
    }

    // The realm-server's POST /_capture surface wired to this
    // suite's real queue and MediaCache store, so cross-surface tests can
    // prove one capture satisfies both the POST response and its GET
    // `_capture/` URL. The matrix stub is never consulted: the realm's
    // permissions have no `users` grant.
    function postCapture(attributes: Record<string, unknown>) {
      let app = new Koa();
      let router = new Router();
      router.post(
        '/_capture',
        jwtMiddleware(realmSecretSeed, dbAdapter),
        handleCapture({
          dbAdapter,
          queue: publisher,
          matrixClient: {
            async getProfile() {
              return null;
            },
          } as unknown as MatrixClient,
          mediaCacheAdapter: adapter,
          captureSyncWaitMs: SYNC_WAIT_MS,
        } as unknown as CreateRoutesArgs),
      );
      app.use(router.routes());
      let token = createJWT(
        { user: OWNER, sessionRoom: '!room:localhost' },
        realmSecretSeed,
      );
      return supertest(app.callback())
        .post('/_capture')
        .set('Authorization', `Bearer ${token}`)
        .send({ data: { type: 'capture', attributes } });
    }

    test('an already-captured spec serves on a gated realm with zero capture work', async function (assert) {
      await seedInstanceRow('card-1');
      await putMedia(dbAdapter, adapter, {
        renderedAs: ANONYMOUS_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: await captureSpecHash({ format: 'isolated' }),
        sourceGeneration: 1,
        bytes: PNG_BYTES,
        contentType: 'image/png',
        lane: 'on-demand',
      });

      let response = await get('_capture/card-1');

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'image/png');
      assert.deepEqual(
        [...(await nodeStreamToBuffer(response.nodeStream!))],
        [...PNG_BYTES],
      );
      assert.strictEqual(captureCalls, 0, 'no render work occurred');
    });

    test('a gated miss is a 403 naming the flag', async function (assert) {
      await seedInstanceRow('card-1');

      let response = await get('_capture/card-1');

      assert.strictEqual(response.status, 403);
      assert.true(
        (await response.text()).includes('allowArbitraryCaptures'),
        'the refusal names the config flag',
      );
      assert.strictEqual(captureCalls, 0);
    });

    test('flipping the indexed config opens the gate with no restart', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(false);

      assert.strictEqual((await get('_capture/card-1')).status, 403);

      // The flag is read from the indexed config on every request, so an
      // index update is all it takes.
      await query(dbAdapter, [
        `UPDATE boxel_index SET pristine_doc = '{"attributes":{"allowArbitraryCaptures":true}}'::jsonb
         WHERE url = '${REALM_URL}realm.json'`,
      ]);
      await startWorker();

      let response = await get('_capture/card-1');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(captureCalls, 1);
    });

    test('the legacy allowArbitraryScreenshots key opens the gate too', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true, 'allowArbitraryScreenshots');
      await startWorker();

      let response = await get('_capture/card-1');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(captureCalls, 1);
    });

    // This realm is world-readable, so its read path takes a session without
    // checking it. A capture is drawn as, and served to, only a reader the
    // realm vouches for, so the checks it skipped run before one is.
    test('a revoked session is served as a reader who authenticated nobody', async function (assert) {
      await seedInstanceRow('card-1');
      await seedCaptureDrawnAs('@revoked-reader:localhost');
      let session = craftSession({
        user: '@revoked-reader:localhost',
        realm: REALM_URL,
        permissions: [],
      });

      let before = await get('_capture/card-1', 'GET', {
        Authorization: `Bearer ${session}`,
      });
      assert.strictEqual(
        before.status,
        200,
        'the session is served the capture drawn as its user',
      );

      await revokeUserSessions(dbAdapter, '@revoked-reader:localhost');
      let after = await get('_capture/card-1', 'GET', {
        Authorization: `Bearer ${session}`,
      });
      assert.strictEqual(
        after.status,
        403,
        "once revoked it isn't, and the closed gate renders nothing for a reader who authenticated nobody",
      );
      assert.strictEqual(captureCalls, 0, 'nothing renders');
    });

    test('a session delegated to another realm is served as a reader who authenticated nobody', async function (assert) {
      await seedInstanceRow('card-1');
      await seedCaptureDrawnAs('@delegated-reader:localhost');

      let elsewhere = await get('_capture/card-1', 'GET', {
        Authorization: `Bearer ${craftSession({
          user: '@delegated-reader:localhost',
          realm: 'http://another-realm.example/',
          permissions: ['read'],
          delegated: true,
        })}`,
      });
      assert.strictEqual(
        elsewhere.status,
        403,
        'a session bound to another realm reads nothing here as its user',
      );

      let here = await get('_capture/card-1', 'GET', {
        Authorization: `Bearer ${craftSession({
          user: '@delegated-reader:localhost',
          realm: REALM_URL,
          permissions: ['read'],
          delegated: true,
        })}`,
      });
      assert.strictEqual(
        here.status,
        200,
        'while one delegated to this realm reads it as the user it acts for',
      );
      assert.strictEqual(captureCalls, 0, 'nothing renders');
    });

    test('an open realm captures on demand, persists, and then serves hits', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      await startWorker();

      let response = await get('_capture/card-1?format=embedded');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'image/png');
      assert.deepEqual(
        [...(await nodeStreamToBuffer(response.nodeStream!))],
        [...PNG_BYTES],
      );
      assert.strictEqual(captureCalls, 1);

      let entry = await findMediaCacheEntry(dbAdapter, {
        servedTo: ANONYMOUS_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: await captureSpecHash({ format: 'embedded' }),
        sourceGeneration: 1,
      });
      assert.strictEqual(entry?.lane, 'on-demand');
      assert.strictEqual(
        entry?.renderedAs,
        ANONYMOUS_RENDER,
        'a reader who authenticated nobody is drawn as nobody',
      );

      let second = await get('_capture/card-1?format=embedded');
      assert.strictEqual(second.status, 200);
      assert.strictEqual(captureCalls, 1, 'the second request is a pure hit');
    });

    test('a failed capture answers 500 with the short cache window', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      await startWorker(() => ({
        status: 'error',
        error: 'capture failed in the engine',
      }));

      let response = await get('_capture/card-1');
      assert.strictEqual(response.status, 500);
      // A failure persists nothing, so no ledger entry short-circuits the
      // repeat; the explicit freshness window is the only thing bounding a
      // capture that fails every time (a fullPage document past the
      // physical-pixel cap) to one render per window instead of one per
      // image load.
      assert.strictEqual(
        response.headers.get('cache-control'),
        `public, max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}`,
        'the failure carries the same short window the miss and gate use',
      );
      assert.strictEqual(captureCalls, 1);
    });

    test('an edited instance never serves a stale capture', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      await startWorker();

      await get('_capture/card-1');
      assert.strictEqual(captureCalls, 1);

      // An edit bumps the instance's index generation, which is part of the
      // cache key.
      await query(dbAdapter, [
        `UPDATE boxel_index SET generation = 2 WHERE url = '${REALM_URL}card-1.json'`,
      ]);

      let response = await get('_capture/card-1');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(captureCalls, 2, 'the edited card re-captured');
    });

    test('a sync wait that outruns the budget answers 503, and the capture still lands', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      captureGate = new Deferred<void>();
      await startWorker();

      let response = await get('_capture/card-1');
      assert.strictEqual(response.status, 503);
      assert.ok(
        Number(response.headers.get('retry-after')) >= 1,
        'the 503 carries a Retry-After',
      );

      // The job kept running; once the render finishes it persists its own
      // capture, so the client retry is a pure ledger hit.
      captureGate.fulfill();
      captureGate = undefined;
      let entryKey = {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: await captureSpecHash({ format: 'isolated' }),
        sourceGeneration: 1,
        servedTo: ANONYMOUS_RENDER,
      };
      let deadline = Date.now() + 10_000;
      while (
        !(await findMediaCacheEntry(dbAdapter, entryKey)) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(
        await findMediaCacheEntry(dbAdapter, entryKey),
        'the timed-out capture persisted anyway',
      );
      let capturesSoFar = captureCalls;
      let retry = await get('_capture/card-1');
      assert.strictEqual(retry.status, 200);
      assert.strictEqual(
        captureCalls,
        capturesSoFar,
        'the retry re-rendered nothing',
      );
    });

    test('a custom-geometry GET captures, persists under its own spec hash, and then serves hits', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      await startWorker();

      let response = await get('_capture/card-1?viewport=1280x800&dsf=2');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(captureCalls, 1);
      assert.deepEqual(
        capturedSpecs[0],
        { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 },
        'the parsed geometry reached the capture engine',
      );

      let customEntry = await findMediaCacheEntry(dbAdapter, {
        servedTo: ANONYMOUS_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: await captureSpecHash({
          format: 'isolated',
          viewport: { width: 1280, height: 800 },
          deviceScaleFactor: 2,
        }),
        sourceGeneration: 1,
      });
      assert.strictEqual(
        customEntry?.lane,
        'on-demand',
        'the capture persisted under the full-spec hash',
      );
      assert.strictEqual(
        await findMediaCacheEntry(dbAdapter, {
          servedTo: ANONYMOUS_RENDER,
          realmURL: REALM_URL,
          sourceURL: `${REALM_URL}card-1`,
          captureSpecHash: await captureSpecHash({ format: 'isolated' }),
          sourceGeneration: 1,
        }),
        undefined,
        'the canonical identity is untouched',
      );

      // Another spelling of the same geometry is the same cache key.
      let second = await get('_capture/card-1?dsf=2.0&viewport=1280x800');
      assert.strictEqual(second.status, 200);
      assert.strictEqual(captureCalls, 1, 'the second request is a pure hit');

      // A different geometry is its own capture identity.
      let different = await get('_capture/card-1?viewport=640x480');
      assert.strictEqual(different.status, 200);
      assert.strictEqual(captureCalls, 2, 'a new spec renders fresh');
    });

    test('the task refuses to persist a render whose spec contradicts the persist identity', async function (assert) {
      // A producer bug no parse layer can catch: the persist identity names
      // the canonical capture while the job renders a custom viewport.
      // Persisting would serve the 1280×800 render on the canonical URL for
      // as long as the source generation holds, so the task re-hashes the
      // rendered spec and refuses the mismatch — while the capture itself
      // still resolves with its bytes.
      await seedInstanceRow('card-1');
      await startWorker();

      let job = await enqueueCaptureJob(
        {
          realmURL: REALM_URL,
          realmUsername: OWNER,
          runAs: OWNER,
          cardId: `${REALM_URL}card-1`,
          sourceKind: 'card',
          format: 'isolated',
          captureSpec: { viewport: { width: 1280, height: 800 } },
          persist: {
            realmURL: REALM_URL,
            sourceURL: `${REALM_URL}card-1`,
            captureSpecHash: await captureSpecHash({ format: 'isolated' }),
            sourceGeneration: 1,
            lane: 'on-demand',
          },
          surface: 'get-dsl',
          loggingCorrelationId: null,
        },
        publisher,
        dbAdapter,
        0,
      );
      let result = await job.done;
      assert.strictEqual(
        result.status,
        'ready',
        'the capture itself still succeeds',
      );
      assert.strictEqual(
        await findMediaCacheEntry(dbAdapter, {
          servedTo: OWNER,
          realmURL: REALM_URL,
          sourceURL: `${REALM_URL}card-1`,
          captureSpecHash: await captureSpecHash({ format: 'isolated' }),
          sourceGeneration: 1,
        }),
        undefined,
        'nothing lands under the mismatched identity',
      );
    });

    test('the task persists a pdf render under the pdf spec identity', async function (assert) {
      await seedInstanceRow('card-1');
      await startWorker();

      let pdfSpecHash = await captureSpecHash({
        format: 'isolated',
        type: 'pdf',
      });
      let job = await enqueueCaptureJob(
        {
          realmURL: REALM_URL,
          realmUsername: OWNER,
          runAs: OWNER,
          cardId: `${REALM_URL}card-1`,
          sourceKind: 'card',
          format: 'isolated',
          captureSpec: { type: 'pdf' },
          persist: {
            realmURL: REALM_URL,
            sourceURL: `${REALM_URL}card-1`,
            captureSpecHash: pdfSpecHash,
            sourceGeneration: 1,
            lane: 'on-demand',
          },
          surface: 'post',
          loggingCorrelationId: null,
        },
        publisher,
        dbAdapter,
        0,
      );
      let result = await job.done;
      assert.strictEqual(result.status, 'ready');
      let entry = await findMediaCacheEntry(dbAdapter, {
        servedTo: OWNER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: pdfSpecHash,
        sourceGeneration: 1,
      });
      assert.strictEqual(
        entry?.contentType,
        'application/pdf',
        'the ledger row carries the paged content type',
      );
      assert.strictEqual(
        entry?.width,
        null,
        'a paged capture records no pixel dimensions',
      );
    });

    test('a pdf GET captures on demand, persists as application/pdf, and serves inline with a filename', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      await startWorker();

      let response = await get('_capture/card-1?type=pdf');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        response.headers.get('content-type'),
        'application/pdf',
      );
      assert.strictEqual(
        response.headers.get('content-disposition'),
        'inline; filename="card-1.pdf"',
      );
      assert.strictEqual(captureCalls, 1);

      // The pdf keys its own ledger entry; the same card's canonical png
      // identity stays uncaptured.
      let pdfEntry = await findMediaCacheEntry(dbAdapter, {
        servedTo: ANONYMOUS_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: await captureSpecHash({
          format: 'isolated',
          type: 'pdf',
        }),
        sourceGeneration: 1,
      });
      assert.strictEqual(pdfEntry?.contentType, 'application/pdf');
      assert.strictEqual(
        await findMediaCacheEntry(dbAdapter, {
          servedTo: ANONYMOUS_RENDER,
          realmURL: REALM_URL,
          sourceURL: `${REALM_URL}card-1`,
          captureSpecHash: await captureSpecHash({ format: 'isolated' }),
          sourceGeneration: 1,
        }),
        undefined,
        'the png identity is untouched',
      );

      // The repeat is a pure ledger hit: zero new Chrome work.
      let hit = await get('_capture/card-1?type=pdf');
      assert.strictEqual(hit.status, 200);
      assert.strictEqual(captureCalls, 1, 'no re-render on the hit');
    });

    test('the task refuses to persist a target render under any claimed identity', async function (assert) {
      // A target capture has no canonical identity: the crop sits outside
      // the identity pick, so hashing the rendered spec would collapse it
      // onto the geometry-only key. The task hashes such a render to null
      // and refuses whatever identity the producer claimed, keeping
      // element-cropped bytes off the whole-viewport URL.
      await seedInstanceRow('card-1');
      await startWorker();

      let job = await enqueueCaptureJob(
        {
          realmURL: REALM_URL,
          realmUsername: OWNER,
          runAs: OWNER,
          cardId: `${REALM_URL}card-1`,
          sourceKind: 'card',
          format: 'isolated',
          captureSpec: { target: '.avatar' },
          persist: {
            realmURL: REALM_URL,
            sourceURL: `${REALM_URL}card-1`,
            captureSpecHash: await captureSpecHash({ format: 'isolated' }),
            sourceGeneration: 1,
            lane: 'on-demand',
          },
          surface: 'post',
          loggingCorrelationId: null,
        },
        publisher,
        dbAdapter,
        0,
      );
      let result = await job.done;
      assert.strictEqual(
        result.status,
        'ready',
        'the capture itself still succeeds',
      );
      assert.strictEqual(
        await findMediaCacheEntry(dbAdapter, {
          servedTo: OWNER,
          realmURL: REALM_URL,
          sourceURL: `${REALM_URL}card-1`,
          captureSpecHash: await captureSpecHash({ format: 'isolated' }),
          sourceGeneration: 1,
        }),
        undefined,
        'the element crop never lands under the geometry-only key',
      );
    });

    test('concurrent misses for one spec coalesce onto one capture', async function (assert) {
      // A custom geometry rather than the bare URL: the persist identity's
      // spec hash is what keys the twin match, so this exercises coalescing
      // for exactly the captures that used to be uncoalesceable.
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      // Recent capture history keeps the congestion pre-check's estimate
      // under the budget while the first capture is in flight, so the
      // second request reaches the queue and can coalesce instead of
      // failing fast.
      let job = await insertJob(dbAdapter, {
        job_type: 'capture',
        concurrency_group: `capture:${REALM_URL}`,
        status: 'resolved',
        finished_at: new Date().toISOString(),
        result: {},
      });
      await query(dbAdapter, [
        `INSERT INTO job_reservations (job_id, created_at, locked_until, completed_at, worker_id)
         VALUES (${Number(job.id)}, NOW() - INTERVAL '200 milliseconds', NOW(), NOW(), 'test-worker')`,
      ]);
      captureGate = new Deferred<void>();
      await startWorker();

      let first = get('_capture/card-1?viewport=1280x800');
      // Wait for the first capture to be claimed and parked on the gate so
      // the second request's publish sees it as an in-flight twin.
      let deadline = Date.now() + 5000;
      while (captureCalls === 0 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      let second = get('_capture/card-1?viewport=1280x800');
      // Give the second request time to publish (and coalesce) before the
      // render completes.
      await new Promise((resolve) => setTimeout(resolve, 100));
      captureGate.fulfill();
      captureGate = undefined;

      let [firstResponse, secondResponse] = await Promise.all([first, second]);
      assert.strictEqual(firstResponse.status, 200);
      assert.strictEqual(secondResponse.status, 200);
      assert.strictEqual(
        captureCalls,
        1,
        'both requests were satisfied by one render',
      );
    });

    test('a congested lane fails fast with 503 + Retry-After', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      // A queued capture already holds the realm's serialized lane; with no
      // worker started it stays pending, and pending × the default capture
      // estimate dwarfs the budget.
      await insertJob(dbAdapter, {
        job_type: 'capture',
        concurrency_group: `capture:${REALM_URL}`,
      });

      let response = await get('_capture/card-1');

      assert.strictEqual(response.status, 503);
      assert.ok(Number(response.headers.get('retry-after')) >= 1);
      assert.strictEqual(captureCalls, 0, 'nothing was enqueued or rendered');
    });

    test('HEAD never reaches the capture route, even for a captured spec', async function (assert) {
      // checkPermission exempts HEAD from auth realm-wide; the GET-only
      // dispatch is what keeps HEAD from becoming an unauthenticated
      // existence/size/content-hash oracle. Even a spec with a live capture
      // answers a HEAD from the generic handlers, not this route.
      await seedInstanceRow('card-1');
      await putMedia(dbAdapter, adapter, {
        renderedAs: ANONYMOUS_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: await captureSpecHash({ format: 'isolated' }),
        sourceGeneration: 1,
        bytes: PNG_BYTES,
        contentType: 'image/png',
        lane: 'on-demand',
      });

      let response = await get('_capture/card-1', 'HEAD');

      assert.notStrictEqual(response.status, 200);
      assert.strictEqual(
        response.headers.get('etag'),
        null,
        'no content-hash validator leaks',
      );
      assert.strictEqual(captureCalls, 0);
    });

    test('parameter errors are 400s naming the field', async function (assert) {
      await seedInstanceRow('card-1');

      let unknown = await get('_capture/card-1?sparkle=true');
      assert.strictEqual(unknown.status, 400);
      assert.true((await unknown.text()).includes('sparkle'));

      let mixed = await get('_capture/card-1?name=hero&format=embedded');
      assert.strictEqual(mixed.status, 400);
      assert.true((await mixed.text()).includes('name cannot be combined'));

      let malformed = await get('_capture/card-1?name=not%20a%20name');
      assert.strictEqual(malformed.status, 400);
      assert.true(
        (await malformed.text()).includes('not a valid capture name'),
      );
    });

    test('a declared name serves through the manifest join with zero capture work', async function (assert) {
      await seedInstanceRow('card-1');
      await putMedia(dbAdapter, adapter, {
        renderedAs: REALM_AUTHORITY_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'declared-hero-spec',
        sourceGeneration: 1,
        bytes: PNG_BYTES,
        contentType: 'image/png',
        lane: 'declared',
      });
      let entry = (await findMediaCacheEntry(dbAdapter, {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'declared-hero-spec',
      }))!;
      await seedManifestRow('card-1', {
        hero: {
          specHash: 'declared-hero-spec',
          objectKey: entry.objectKey,
          contentType: 'image/png',
          width: 800,
          height: 600,
          deviceScaleFactor: 2,
        },
      });

      // The realm's capture gate stays closed: names never trigger capture
      // work, so they serve regardless of it.
      let response = await get('_capture/card-1?name=hero');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.headers.get('content-type'), 'image/png');
      assert.strictEqual(
        response.headers.get('etag'),
        `"${entry.objectKey}"`,
        'the ETag is the content hash',
      );
      assert.deepEqual(
        [...(await nodeStreamToBuffer(response.nodeStream!))],
        [...PNG_BYTES],
      );
      assert.strictEqual(captureCalls, 0);
      assert.strictEqual(perfEvents.length, 1, 'one record for the hit');
      let event = perfEvents[0] as CaptureRequestPerfEvent;
      assert.strictEqual(event.surface, 'get-named');
      assert.strictEqual(event.outcome, 'hit');
      assert.strictEqual(event.lane, 'declared');

      let revalidated = await get('_capture/card-1?name=hero', 'GET', {
        'if-none-match': `"${entry.objectKey}"`,
      });
      assert.strictEqual(
        revalidated.status,
        304,
        'an If-None-Match echo answers as a bodyless 304',
      );
    });

    test('a declared pdf serves under its manifest filename, and the request can ask for a download or a different name', async function (assert) {
      await seedInstanceRow('card-1');
      await putMedia(dbAdapter, adapter, {
        renderedAs: REALM_AUTHORITY_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'declared-statement-spec',
        sourceGeneration: 1,
        bytes: PDF_BYTES,
        contentType: 'application/pdf',
        lane: 'declared',
      });
      let entry = (await findMediaCacheEntry(dbAdapter, {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'declared-statement-spec',
      }))!;
      await seedManifestRow('card-1', {
        statement: {
          specHash: 'declared-statement-spec',
          objectKey: entry.objectKey,
          contentType: 'application/pdf',
          pageCount: 2,
          byteSize: PDF_BYTES.byteLength,
          filename: 'Relevé Q3',
        },
      });

      let inline = await get('_capture/card-1?name=statement');
      assert.strictEqual(inline.status, 200);
      assert.strictEqual(
        inline.headers.get('content-disposition'),
        `inline; filename="Releve Q3.pdf"; filename*=UTF-8''Relev%C3%A9%20Q3.pdf`,
        'the manifest filename names the document',
      );

      let download = await get('_capture/card-1?name=statement&download=1');
      assert.strictEqual(download.status, 200);
      assert.strictEqual(
        download.headers.get('content-disposition'),
        `attachment; filename="Releve Q3.pdf"; filename*=UTF-8''Relev%C3%A9%20Q3.pdf`,
      );

      let renamed = await get(
        '_capture/card-1?name=statement&download&filename=My%20Statement',
      );
      assert.strictEqual(renamed.status, 200);
      assert.strictEqual(
        renamed.headers.get('content-disposition'),
        'attachment; filename="My Statement.pdf"',
        'the request filename overrides the declared one',
      );
      assert.strictEqual(
        renamed.headers.get('etag'),
        `"${entry.objectKey}"`,
        'the same object serves whatever the disposition',
      );
      assert.deepEqual(
        [...(await nodeStreamToBuffer(renamed.nodeStream!))],
        [...PDF_BYTES],
      );
      assert.strictEqual(captureCalls, 0, 'disposition never triggers capture');
    });

    test('a declared pdf whose manifest records no filename serves under the source URL segment', async function (assert) {
      await seedInstanceRow('card-1');
      await putMedia(dbAdapter, adapter, {
        renderedAs: REALM_AUTHORITY_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'declared-statement-spec',
        sourceGeneration: 1,
        bytes: PDF_BYTES,
        contentType: 'application/pdf',
        lane: 'declared',
      });
      let entry = (await findMediaCacheEntry(dbAdapter, {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'declared-statement-spec',
      }))!;
      await seedManifestRow('card-1', {
        statement: {
          specHash: 'declared-statement-spec',
          objectKey: entry.objectKey,
          contentType: 'application/pdf',
        },
      });

      let response = await get('_capture/card-1?name=statement');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        response.headers.get('content-disposition'),
        'inline; filename="card-1.pdf"',
      );
    });

    test('a declared image downloads only when asked, under its content type extension', async function (assert) {
      await seedInstanceRow('card-1');
      await putMedia(dbAdapter, adapter, {
        renderedAs: REALM_AUTHORITY_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'declared-hero-spec',
        sourceGeneration: 1,
        bytes: PNG_BYTES,
        contentType: 'image/png',
        lane: 'declared',
      });
      let entry = (await findMediaCacheEntry(dbAdapter, {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'declared-hero-spec',
      }))!;
      await seedManifestRow('card-1', {
        hero: {
          specHash: 'declared-hero-spec',
          objectKey: entry.objectKey,
          contentType: 'image/png',
          width: 800,
          height: 600,
          deviceScaleFactor: 2,
        },
      });

      let plain = await get('_capture/card-1?name=hero');
      assert.strictEqual(plain.headers.get('content-disposition'), null);

      let download = await get('_capture/card-1?name=hero&download=true');
      assert.strictEqual(
        download.headers.get('content-disposition'),
        'attachment; filename="card-1.png"',
      );
    });

    test('a pdf GET honors the disposition params on the capture miss and on the ledger hit', async function (assert) {
      await seedInstanceRow('card-1');
      await seedRealmConfigRow(true);
      await startWorker();

      let rendered = await get(
        '_capture/card-1?type=pdf&download=1&filename=Q3%20Statement',
      );
      assert.strictEqual(rendered.status, 200);
      assert.strictEqual(
        rendered.headers.get('content-disposition'),
        'attachment; filename="Q3 Statement.pdf"',
      );
      assert.strictEqual(captureCalls, 1);

      let hit = await get('_capture/card-1?type=pdf&filename=Other');
      assert.strictEqual(hit.status, 200);
      assert.strictEqual(
        hit.headers.get('content-disposition'),
        'inline; filename="Other.pdf"',
      );
      assert.strictEqual(
        captureCalls,
        1,
        'the disposition params are not part of the capture identity',
      );
    });

    test('disposition parameter errors are 400s naming the param', async function (assert) {
      await seedInstanceRow('card-1');

      let badDownload = await get('_capture/card-1?name=hero&download=maybe');
      assert.strictEqual(badDownload.status, 400);
      assert.true((await badDownload.text()).includes('download must be'));

      let repeated = await get(
        '_capture/card-1?type=pdf&filename=a&filename=b',
      );
      assert.strictEqual(repeated.status, 400);
      assert.true(
        (await repeated.text()).includes('filename may only be given once'),
      );

      let mixed = await get(
        '_capture/card-1?name=hero&download=1&format=embedded',
      );
      assert.strictEqual(mixed.status, 400);
      assert.true(
        (await mixed.text()).includes('name cannot be combined'),
        'only the disposition params are exempt from name exclusivity',
      );
    });

    test('a name serves the exact object its manifest advertises, not a newer ledger row', async function (assert) {
      await seedInstanceRow('card-1');
      let olderBytes = PNG_BYTES;
      let newerBytes = new TextEncoder().encode('newer-png-bytes');
      await putMedia(dbAdapter, adapter, {
        renderedAs: REALM_AUTHORITY_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'declared-hero-spec',
        sourceGeneration: 1,
        bytes: olderBytes,
        contentType: 'image/png',
        lane: 'declared',
      });
      let older = (await findMediaCacheEntry(dbAdapter, {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'declared-hero-spec',
        sourceGeneration: 1,
      }))!;
      // A fresher capture has persisted (media lands before its manifest
      // publishes), but the manifest still names the older artifact.
      await putMedia(dbAdapter, adapter, {
        renderedAs: REALM_AUTHORITY_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'declared-hero-spec',
        sourceGeneration: 2,
        bytes: newerBytes,
        contentType: 'image/png',
        lane: 'declared',
      });
      await seedManifestRow('card-1', {
        hero: {
          specHash: 'declared-hero-spec',
          objectKey: older.objectKey,
          contentType: 'image/png',
          width: 800,
          height: 600,
          deviceScaleFactor: 2,
        },
      });

      let response = await get('_capture/card-1?name=hero');
      assert.strictEqual(response.status, 200);
      assert.strictEqual(
        response.headers.get('etag'),
        `"${older.objectKey}"`,
        'the served ETag is exactly the hash meta.captures advertises',
      );
      assert.deepEqual(
        [...(await nodeStreamToBuffer(response.nodeStream!))],
        [...olderBytes],
        'the served bytes are the manifest-pinned artifact',
      );
    });

    test('an unknown or not-yet-captured name is an uncaptured miss', async function (assert) {
      await seedInstanceRow('card-1');

      // Live instance, no manifest at all: not yet prerendered with capture
      // support.
      let unrendered = await get('_capture/card-1?name=hero');
      assert.strictEqual(unrendered.status, 404);
      assert.true(
        unrendered.headers
          .get('cache-control')!
          .includes(`max-age=${MEDIA_CACHE_MAX_AGE_SECONDS}`),
        'the miss carries a short freshness window so a later capture is picked up',
      );

      // A manifest that holds other names: this one failed or was never
      // declared.
      await seedManifestRow('card-1', {
        other: {
          specHash: 'declared-other-spec',
          objectKey: 'nonexistent-object',
          contentType: 'image/png',
          width: 800,
          height: 600,
          deviceScaleFactor: 2,
        },
      });
      let unknownName = await get('_capture/card-1?name=hero');
      assert.strictEqual(unknownName.status, 404);

      // A manifest entry whose ledger row is gone (reclaimed): still a miss,
      // never an error.
      let reclaimed = await get('_capture/card-1?name=other');
      assert.strictEqual(reclaimed.status, 404);

      assert.strictEqual(captureCalls, 0);
      assert.deepEqual(perfEvents, [], 'uncaptured misses emit no telemetry');
    });

    test('a deleted instance stops serving its declared captures', async function (assert) {
      await seedInstanceRow('card-1');
      await putMedia(dbAdapter, adapter, {
        renderedAs: REALM_AUTHORITY_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'declared-hero-spec',
        sourceGeneration: 1,
        bytes: PNG_BYTES,
        contentType: 'image/png',
        lane: 'declared',
      });
      let entry = (await findMediaCacheEntry(dbAdapter, {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: 'declared-hero-spec',
      }))!;
      await seedManifestRow('card-1', {
        hero: {
          specHash: 'declared-hero-spec',
          objectKey: entry.objectKey,
          contentType: 'image/png',
          width: 800,
          height: 600,
          deviceScaleFactor: 2,
        },
      });
      await query(dbAdapter, [
        `UPDATE boxel_index SET is_deleted = TRUE WHERE url = '${REALM_URL}card-1.json'`,
      ]);

      let response = await get('_capture/card-1?name=hero');
      assert.strictEqual(response.status, 404);
    });

    test('card+json joins the manifest into meta.captures', async function (assert) {
      let { nameExpressions, valueExpressions } = asExpressions(
        {
          url: `${REALM_URL}card-2.json`,
          file_alias: `${REALM_URL}card-2`,
          realm_url: REALM_URL,
          type: 'instance',
          generation: 1,
          last_modified: Date.now(),
          resource_created_at: Date.now(),
          is_deleted: false,
          pristine_doc: {
            id: `${REALM_URL}card-2`,
            type: 'card',
            attributes: {},
          },
        },
        { jsonFields: ['pristine_doc'] },
      );
      await query(
        dbAdapter,
        insert('boxel_index', nameExpressions, valueExpressions),
      );
      await putMedia(dbAdapter, adapter, {
        renderedAs: REALM_AUTHORITY_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-2`,
        captureSpecHash: 'declared-hero-spec',
        sourceGeneration: 1,
        bytes: PNG_BYTES,
        contentType: 'image/png',
        lane: 'declared',
      });
      let entry = (await findMediaCacheEntry(dbAdapter, {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-2`,
        captureSpecHash: 'declared-hero-spec',
      }))!;
      await seedManifestRow('card-2', {
        hero: {
          specHash: 'declared-hero-spec',
          objectKey: entry.objectKey,
          contentType: 'image/png',
          width: 800,
          height: 600,
          deviceScaleFactor: 2,
          useAsThumbnail: true,
        },
      });

      let response = await get('card-2', 'GET', {
        Accept: 'application/vnd.card+json',
      });
      assert.strictEqual(response.status, 200);
      let json = await response.json();
      assert.deepEqual(
        json.data.meta.captures,
        {
          hero: {
            url: `${REALM_URL}_capture/card-2?name=hero`,
            hash: entry.objectKey,
            contentType: 'image/png',
            width: 800,
            height: 600,
            deviceScaleFactor: 2,
            useAsThumbnail: true,
          },
        },
        'the manifest joins into meta.captures in its public projection',
      );

      // An instance with no manifest gets no key at all — absence is the
      // signal consumers fall back on.
      await seedInstanceRow('card-1');
      let bare = await get('card-1', 'GET', {
        Accept: 'application/vnd.card+json',
      });
      assert.strictEqual(bare.status, 200);
      let bareJson = await bare.json();
      assert.strictEqual(bareJson.data.meta.captures, undefined);
    });

    test('the card+json validator rotates when the manifest changes, without any index write', async function (assert) {
      await seedInstanceRow('card-1');
      // A null `indexed_at` suppresses ETag emission entirely; a validator
      // needs a real index stamp to build on.
      await query(dbAdapter, [
        `UPDATE boxel_index SET indexed_at = ${Date.now()} WHERE url = '${REALM_URL}card-1.json'`,
      ]);
      await seedManifestRow('card-1', {
        hero: {
          specHash: 'declared-hero-spec',
          objectKey: 'object-a',
          contentType: 'image/png',
          width: 800,
          height: 600,
          deviceScaleFactor: 2,
        },
      });

      let first = await get('card-1', 'GET', {
        Accept: 'application/vnd.card+json',
      });
      assert.strictEqual(first.status, 200);
      let etag = first.headers.get('etag')!;
      assert.ok(etag, 'the response carries a validator');

      let revalidated = await get('card-1', 'GET', {
        Accept: 'application/vnd.card+json',
        'if-none-match': etag,
      });
      assert.strictEqual(
        revalidated.status,
        304,
        'an unchanged manifest revalidates as a 304',
      );

      // A re-capture repoints the manifest — a prerendered_html write that
      // moves neither `indexed_at` nor the realm info. The old validator
      // must stop matching or a cached document 304s past its own
      // captures forever.
      await query(dbAdapter, [
        `UPDATE prerendered_html
           SET captures = '{"hero":{"specHash":"declared-hero-spec","objectKey":"object-b","contentType":"image/png","width":800,"height":600,"deviceScaleFactor":2}}'::jsonb
         WHERE url = '${REALM_URL}card-1.json'`,
      ]);
      let recaptured = await get('card-1', 'GET', {
        Accept: 'application/vnd.card+json',
        'if-none-match': etag,
      });
      assert.strictEqual(
        recaptured.status,
        200,
        'a changed manifest fails the old validator',
      );
      let json = await recaptured.json();
      assert.strictEqual(
        json.data.meta.captures.hero.hash,
        'object-b',
        'the full response carries the fresh manifest',
      );
      assert.notStrictEqual(
        recaptured.headers.get('etag'),
        etag,
        'the new response carries a rotated validator',
      );
    });

    test('a missing instance is an uncaptured miss, not a capture attempt', async function (assert) {
      await seedRealmConfigRow(true);
      await startWorker();

      let response = await get('_capture/nope');

      assert.strictEqual(response.status, 404);
      assert.strictEqual(captureCalls, 0);
      assert.deepEqual(perfEvents, [], 'addressing misses emit no telemetry');
    });

    test('a POSTed capture serves back to its requester on its GET URL, and to no other reader', async function (assert) {
      await seedInstanceRow('card-1');
      // The realm's capture gate stays closed: the POST surface captures
      // under realm-read trust, and the GET route serves existing ledger
      // entries regardless of the gate.
      await startWorker();
      let captureSpec = {
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 2,
      };

      let response = await postCapture({
        realmURL: REALM_URL,
        cardId: `${REALM_URL}card-1`,
        format: 'isolated',
        captureSpec,
      });
      assert.strictEqual(response.status, 201);
      assert.strictEqual(captureCalls, 1);
      let served = response.body.data.attributes.captures?.[0]?.url as string;
      assert.strictEqual(
        served,
        `${REALM_URL}_capture/card-1?viewport=1280x800&dsf=2`,
        'the served URL spells the spec in the GET grammar',
      );

      let getResponse = await get(served.slice(REALM_URL.length), 'GET', {
        Authorization: `Bearer ${realmSession(OWNER)}`,
      });
      assert.strictEqual(getResponse.status, 200);
      assert.deepEqual(
        [...(await nodeStreamToBuffer(getResponse.nodeStream!))],
        [...PNG_BYTES],
      );
      assert.strictEqual(
        captureCalls,
        1,
        "the requester's GET is a pure ledger hit on the POSTed capture",
      );
      assert.true(
        getResponse.headers.get('cache-control')?.startsWith('private,'),
        `no shared cache may hold one reader's capture: ${getResponse.headers.get('cache-control')}`,
      );

      let anonymous = await get(served.slice(REALM_URL.length));
      assert.strictEqual(
        anonymous.status,
        403,
        "another reader isn't served it, and the closed gate renders nothing new for them",
      );
      assert.strictEqual(captureCalls, 1, 'nothing rendered for them either');
    });

    test('a POSTed file capture serves back to its requester on its GET URL, and to no other reader', async function (assert) {
      await seedFileRow('brand/guide.html');
      await startWorker();

      let response = await postCapture({
        realmURL: REALM_URL,
        fileURL: `${REALM_URL}brand/guide.html`,
        format: 'isolated',
      });
      assert.strictEqual(response.status, 201);
      assert.strictEqual(captureCalls, 1);
      let served = response.body.data.attributes.captures?.[0]?.url as string;
      assert.strictEqual(
        served,
        `${REALM_URL}_capture/brand/guide.html`,
        "the served URL keeps the file's extension",
      );

      let getResponse = await get(served.slice(REALM_URL.length), 'GET', {
        Authorization: `Bearer ${realmSession(OWNER)}`,
      });
      assert.strictEqual(getResponse.status, 200);
      assert.deepEqual(
        [...(await nodeStreamToBuffer(getResponse.nodeStream!))],
        [...PNG_BYTES],
      );
      assert.strictEqual(
        captureCalls,
        1,
        "the requester's GET is a pure ledger hit on the POSTed capture",
      );
      assert.true(
        getResponse.headers.get('cache-control')?.startsWith('private,'),
        `no shared cache may hold one reader's capture: ${getResponse.headers.get('cache-control')}`,
      );

      let anonymous = await get(served.slice(REALM_URL.length));
      assert.strictEqual(
        anonymous.status,
        403,
        "another reader isn't served it, and the closed gate renders nothing new for them",
      );
      assert.strictEqual(captureCalls, 1, 'nothing rendered for them either');
    });

    test('an open realm captures a file on demand through its file rendering, keyed by the file row', async function (assert) {
      await seedFileRow('brand/guide.html', { generation: 4 });
      await seedRealmConfigRow(true);
      await startWorker();

      let response = await get('_capture/brand/guide.html');
      assert.strictEqual(response.status, 200);
      assert.deepEqual(
        [...(await nodeStreamToBuffer(response.nodeStream!))],
        [...PNG_BYTES],
      );
      assert.strictEqual(captureCalls, 1);
      assert.true(
        (capturedRenderOptions[0] as { fileRender?: boolean } | null)
          ?.fileRender,
        'the capture renders the file, not a card',
      );
      let entry = await findMediaCacheEntry(dbAdapter, {
        servedTo: ANONYMOUS_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}brand/guide.html`,
        captureSpecHash: await captureSpecHash({ format: 'isolated' }),
        sourceGeneration: 4,
      });
      assert.strictEqual(entry?.lane, 'on-demand');

      let second = await get('_capture/brand/guide.html');
      assert.strictEqual(second.status, 200);
      assert.strictEqual(captureCalls, 1, 'the second request is a pure hit');

      // An edit bumps the file row's generation, which is part of the key.
      await query(dbAdapter, [
        `UPDATE boxel_index SET generation = 5 WHERE url = '${REALM_URL}brand/guide.html'`,
      ]);
      let edited = await get('_capture/brand/guide.html');
      assert.strictEqual(edited.status, 200);
      assert.strictEqual(captureCalls, 2, 'the edited file re-captured');
    });

    test('a deleted file stops serving its captures', async function (assert) {
      await seedFileRow('brand/guide.html');
      await putMedia(dbAdapter, adapter, {
        renderedAs: ANONYMOUS_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}brand/guide.html`,
        captureSpecHash: await captureSpecHash({ format: 'isolated' }),
        sourceGeneration: 1,
        bytes: PNG_BYTES,
        contentType: 'image/png',
        lane: 'on-demand',
      });
      assert.strictEqual(
        (await get('_capture/brand/guide.html')).status,
        200,
        'the live file serves its capture',
      );

      await query(dbAdapter, [
        `UPDATE boxel_index SET is_deleted = TRUE WHERE url = '${REALM_URL}brand/guide.html'`,
      ]);

      assert.strictEqual((await get('_capture/brand/guide.html')).status, 404);
    });

    test("a card's .json spelling addresses its file row, and the extensionless id its instance", async function (assert) {
      await seedInstanceRow('card-1');
      await seedFileRow('card-1.json', { alias: `${REALM_URL}card-1` });
      let isolated = await captureSpecHash({ format: 'isolated' });
      let fileBytes = new TextEncoder().encode('file-capture-bytes');
      await putMedia(dbAdapter, adapter, {
        renderedAs: ANONYMOUS_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: isolated,
        sourceGeneration: 1,
        bytes: PNG_BYTES,
        contentType: 'image/png',
        lane: 'on-demand',
      });
      await putMedia(dbAdapter, adapter, {
        renderedAs: ANONYMOUS_RENDER,
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1.json`,
        captureSpecHash: isolated,
        sourceGeneration: 1,
        bytes: fileBytes,
        contentType: 'image/png',
        lane: 'on-demand',
      });

      let card = await get('_capture/card-1');
      assert.strictEqual(card.status, 200);
      assert.deepEqual(
        [...(await nodeStreamToBuffer(card.nodeStream!))],
        [...PNG_BYTES],
        'the extensionless id serves the card capture',
      );
      let file = await get('_capture/card-1.json');
      assert.strictEqual(file.status, 200);
      assert.deepEqual(
        [...(await nodeStreamToBuffer(file.nodeStream!))],
        [...fileBytes],
        'the extension spelling serves the file capture',
      );
    });

    test('a .json path with no live file row still addresses the instance', async function (assert) {
      await seedInstanceRow('card-1');
      await seedCaptureDrawnAs(ANONYMOUS_RENDER);

      let response = await get('_capture/card-1.json');
      assert.strictEqual(response.status, 200);
      assert.deepEqual(
        [...(await nodeStreamToBuffer(response.nodeStream!))],
        [...PNG_BYTES],
      );
    });

    test('an extensionless file is never captured through the GET route', async function (assert) {
      // `notes` is spelled like a card id, so its capture would key as a card
      // capture of `notes`.
      await seedFileRow('notes');
      await seedRealmConfigRow(true);
      await startWorker();

      let response = await get('_capture/notes');
      assert.strictEqual(response.status, 404);
      assert.strictEqual(captureCalls, 0);
    });

    test('a file path does not land on another file row by its alias', async function (assert) {
      // A file row's alias drops `.json`, so `guide.html.json`'s row carries
      // `guide.html` as its alias. A request for `guide.html` names a
      // different file, which that row must not answer for.
      await seedFileRow('guide.html.json', {
        alias: `${REALM_URL}guide.html`,
      });
      await seedRealmConfigRow(true);
      await startWorker();

      let response = await get('_capture/guide.html');
      assert.strictEqual(response.status, 404);
      assert.strictEqual(captureCalls, 0);
    });

    test('a timed-out custom-spec POST persists anyway; the retry answers from the ledger', async function (assert) {
      await seedInstanceRow('card-1');
      captureGate = new Deferred<void>();
      await startWorker();
      let captureSpec = { viewport: { width: 1280, height: 800 } };
      let attributes = {
        realmURL: REALM_URL,
        cardId: `${REALM_URL}card-1`,
        format: 'isolated',
        captureSpec,
      };

      let response = await postCapture(attributes);
      assert.strictEqual(response.status, 503);
      assert.ok(
        Number(response.headers['retry-after']) >= 1,
        'the 503 carries a Retry-After',
      );

      // The abandoned job still lands its capture under the full-spec
      // identity — the honesty the Retry-After hint rests on.
      captureGate.fulfill();
      captureGate = undefined;
      let entryKey = {
        realmURL: REALM_URL,
        sourceURL: `${REALM_URL}card-1`,
        captureSpecHash: await captureSpecHash({
          format: 'isolated' as const,
          ...captureSpec,
        }),
        sourceGeneration: 1,
        servedTo: OWNER,
      };
      let deadline = Date.now() + 10_000;
      while (
        !(await findMediaCacheEntry(dbAdapter, entryKey)) &&
        Date.now() < deadline
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(
        await findMediaCacheEntry(dbAdapter, entryKey),
        'the timed-out custom capture persisted anyway',
      );

      let capturesSoFar = captureCalls;
      let retry = await postCapture(attributes);
      assert.strictEqual(retry.status, 201);
      assert.strictEqual(
        captureCalls,
        capturesSoFar,
        'the retry re-rendered nothing',
      );
      assert.strictEqual(
        retry.body.data.attributes.captures?.[0]?.url,
        `${REALM_URL}_capture/card-1?viewport=1280x800`,
      );
    });

    module('capture-stage telemetry', function () {
      function requestEvent(): CaptureRequestPerfEvent | undefined {
        return perfEvents.find(
          (event): event is CaptureRequestPerfEvent =>
            event.eventType === 'request',
        );
      }
      function captureEvent(): CaptureRunPerfEvent | undefined {
        return perfEvents.find(
          (event): event is CaptureRunPerfEvent =>
            event.eventType === 'capture',
        );
      }

      test('a rendered capture emits correlated request and capture records, and the ledger row keeps the breakdown', async function (assert) {
        await seedInstanceRow('card-1');
        await seedRealmConfigRow(true);
        await startWorker();

        let response = await get('_capture/card-1?format=embedded', 'GET', {
          'x-boxel-logging-correlation-id': 'corr-dsl-1',
        });
        assert.strictEqual(response.status, 200);

        let request = requestEvent();
        assert.strictEqual(request?.outcome, 'rendered');
        assert.strictEqual(request?.surface, 'get-dsl');
        assert.strictEqual(request?.correlationId, 'corr-dsl-1');
        assert.false(request?.hasTwin);
        assert.strictEqual(request?.sourceURL, `${REALM_URL}card-1`);
        assert.strictEqual(typeof request?.jobId, 'number');
        let stages = [
          'generationLookupMs',
          'ledgerLookupMs',
          'gateMs',
          'precheckMs',
          'enqueueMs',
          'jobWaitMs',
          'serveMs',
        ] as const;
        let stageSum = 0;
        for (let stage of stages) {
          let value = request?.[stage];
          assert.strictEqual(typeof value, 'number', `${stage} is recorded`);
          stageSum += value as number;
        }
        assert.ok(
          stageSum <= request!.totalMs,
          `stages (${stageSum}ms) sum to at most the wall-clock (${request!.totalMs}ms)`,
        );

        let capture = captureEvent();
        assert.strictEqual(capture?.status, 'ready');
        assert.strictEqual(
          capture?.correlationId,
          'corr-dsl-1',
          'the capture record carries the surface request correlation id',
        );
        assert.strictEqual(
          capture?.jobId,
          request?.jobId,
          'request and capture records join on the job id',
        );
        assert.strictEqual(typeof capture?.reservationId, 'number');
        assert.strictEqual(
          typeof capture?.queueWaitMs,
          'number',
          'queue wait comes from the claim clock via JobInfo',
        );
        assert.strictEqual(capture?.surface, 'get-dsl');
        assert.strictEqual(capture?.lane, 'on-demand');
        assert.strictEqual(capture?.persistOutcome, 'uploaded');
        assert.strictEqual(capture?.prerenderRequestId, 'stub-prerender-req');
        assert.strictEqual(capture?.launchMs, 5);
        assert.strictEqual(capture?.semaphoreMs, 1);
        assert.strictEqual(capture?.renderMs, 20);
        assert.strictEqual(capture?.navMs, 4);
        assert.strictEqual(capture?.settleMs, 6);
        assert.strictEqual(capture?.imagePaintMs, 7);
        assert.strictEqual(capture?.cdpCaptureMs, 3);
        assert.true(capture?.tabReused);
        assert.strictEqual(typeof capture?.permissionsMs, 'number');
        assert.strictEqual(typeof capture?.prerenderMs, 'number');
        assert.strictEqual(typeof capture?.decodeMs, 'number');
        assert.strictEqual(typeof capture?.persistMs, 'number');

        // `MediaCacheEntry` deliberately omits the diagnostics column (the
        // serve path never reads it), so the ledger copy is asserted with
        // its own query.
        let rows = (await query(dbAdapter, [
          `SELECT diagnostics FROM media_cache_ledger WHERE source_url = '${REALM_URL}card-1'`,
        ])) as { diagnostics: Record<string, unknown> | null }[];
        let diagnostics = rows[0]?.diagnostics;
        assert.strictEqual(
          diagnostics?.eventType,
          'capture',
          'the ledger row persists the capture record',
        );
        assert.strictEqual(diagnostics?.persistOutcome, 'uploaded');
        assert.strictEqual(diagnostics?.correlationId, 'corr-dsl-1');
        assert.strictEqual(typeof diagnostics?.queueWaitMs, 'number');
      });

      test('a ledger hit is visibly the hit path: one request record, zero render attribution', async function (assert) {
        await seedInstanceRow('card-1');
        await putMedia(dbAdapter, adapter, {
          renderedAs: ANONYMOUS_RENDER,
          realmURL: REALM_URL,
          sourceURL: `${REALM_URL}card-1`,
          captureSpecHash: await captureSpecHash({ format: 'isolated' }),
          sourceGeneration: 1,
          bytes: PNG_BYTES,
          contentType: 'image/png',
          lane: 'on-demand',
        });

        let response = await get('_capture/card-1');
        assert.strictEqual(response.status, 200);

        assert.strictEqual(perfEvents.length, 1, 'one record for a hit');
        let request = requestEvent();
        assert.strictEqual(request?.outcome, 'hit');
        assert.strictEqual(request?.jobId, null, 'no job ran');
        assert.strictEqual(request?.jobWaitMs, undefined);
        assert.strictEqual(typeof request?.serveMs, 'number');
        assert.strictEqual(typeof request?.ledgerLookupMs, 'number');
      });

      test('a gated miss emits a gated record and stops at the gate', async function (assert) {
        await seedInstanceRow('card-1');

        let response = await get('_capture/card-1');
        assert.strictEqual(response.status, 403);

        let request = requestEvent();
        assert.strictEqual(request?.outcome, 'gated');
        assert.strictEqual(typeof request?.gateMs, 'number');
        assert.strictEqual(request?.precheckMs, undefined);
        assert.strictEqual(request?.enqueueMs, undefined);
      });

      test('a congested 503 emits a congested record and upholds the Retry-After contract', async function (assert) {
        await seedInstanceRow('card-1');
        await seedRealmConfigRow(true);
        await insertJob(dbAdapter, {
          job_type: 'capture',
          concurrency_group: `capture:${REALM_URL}`,
        });

        let response = await get('_capture/card-1');

        assert.strictEqual(response.status, 503);
        // The client half of this contract is the host's auth service
        // worker, which absorbs exactly a 503 whose Retry-After parses as a
        // number and which it can read cross-origin — so both properties
        // are pinned here, not just prose.
        let retryAfter = response.headers.get('retry-after');
        assert.true(
          Number.isInteger(Number(retryAfter)),
          `Retry-After is an integer (got ${retryAfter})`,
        );
        assert.true(
          Number(retryAfter) >= 1,
          `Retry-After is at least one second (got ${retryAfter})`,
        );
        assert.ok(
          (response.headers.get('access-control-expose-headers') ?? '')
            .toLowerCase()
            .includes('retry-after'),
          'Retry-After is CORS-exposed so cross-origin callers can read it',
        );

        let request = requestEvent();
        assert.strictEqual(request?.outcome, 'congested');
        assert.false(request?.hasTwin);
        assert.strictEqual(typeof request?.precheckMs, 'number');
        assert.strictEqual(request?.enqueueMs, undefined, 'nothing enqueued');
      });

      test('a timed-out sync wait emits a timeout record; the capture record follows when the job lands', async function (assert) {
        await seedInstanceRow('card-1');
        await seedRealmConfigRow(true);
        captureGate = new Deferred<void>();
        await startWorker();

        let response = await get('_capture/card-1');
        assert.strictEqual(response.status, 503);

        let request = requestEvent();
        assert.strictEqual(request?.outcome, 'timeout');
        assert.strictEqual(typeof request?.jobId, 'number');
        assert.ok(
          (request?.jobWaitMs ?? 0) >= SYNC_WAIT_MS - 50,
          'the wait ran the full sync budget',
        );

        captureGate.fulfill();
        captureGate = undefined;
        let deadline = Date.now() + 10_000;
        while (!captureEvent() && Date.now() < deadline) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
        let capture = captureEvent();
        assert.strictEqual(
          capture?.jobId,
          request?.jobId,
          'the late capture record still joins the timed-out request',
        );
        assert.strictEqual(capture?.persistOutcome, 'uploaded');
      });

      test('a job that throws still emits: an error capture record and an error request record', async function (assert) {
        await seedInstanceRow('card-1');
        await seedRealmConfigRow(true);
        captureFailure = new Error('prerender exhausted its retries');
        await startWorker();

        let response = await get('_capture/card-1');
        assert.strictEqual(response.status, 500);

        let request = requestEvent();
        assert.strictEqual(
          request?.outcome,
          'error',
          'a rejected job reads as a rise in error, not a drop in request volume',
        );
        assert.strictEqual(typeof request?.jobId, 'number');
        assert.strictEqual(typeof request?.jobWaitMs, 'number');

        let capture = captureEvent();
        assert.strictEqual(capture?.status, 'error');
        assert.strictEqual(capture?.persistOutcome, 'skipped');
        assert.strictEqual(
          capture?.jobId,
          request?.jobId,
          'the failed capture record still joins its request',
        );
        assert.strictEqual(typeof capture?.permissionsMs, 'number');
        assert.strictEqual(
          typeof capture?.prerenderMs,
          'number',
          'the throw is attributed to the prerender stage',
        );
      });

      test('re-capturing identical bytes records a dedupe-on-write hit', async function (assert) {
        await seedInstanceRow('card-1');
        await seedRealmConfigRow(true);
        await startWorker();

        assert.strictEqual((await get('_capture/card-1')).status, 200);
        // An edit bumps the generation — a new capture identity — but the
        // stub render produces the same bytes, so the store dedupes the
        // upload while the ledger gains a row.
        await query(dbAdapter, [
          `UPDATE boxel_index SET generation = 2 WHERE url = '${REALM_URL}card-1.json'`,
        ]);
        perfEvents = [];
        setCapturePerfSink((event) => perfEvents.push(event));

        assert.strictEqual((await get('_capture/card-1')).status, 200);
        assert.strictEqual(captureCalls, 2, 'the edit forced a re-render');
        assert.strictEqual(captureEvent()?.persistOutcome, 'deduped');
      });
    });
  });
});
