// StlDef is a FileDef subclass for `.stl` 3D-print meshes. These tests exercise
// the real base modules loaded through the realm loader:
//
//   1. `extractStlFormat` classifies binary vs ASCII from the first bytes plus
//      the file size, and rejects non-STL bytes with FileContentMismatchError.
//   2. `StlDef.extractAttributes` stamps the `format` field, inherits the base
//      name/contentType/size, and guards the file extension.

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common/loader';

import { setupLocalIndexing, testRealmURL } from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;

// A size-consistent binary STL: 80-byte header, little-endian uint32 triangle
// count, then 50 bytes/triangle. The mesh payload is left zeroed — only the
// header size identity matters to the classifier.
function binaryStl(triangleCount: number): Uint8Array {
  let size = 84 + 50 * triangleCount;
  let bytes = new Uint8Array(size);
  new DataView(bytes.buffer).setUint32(
    80,
    triangleCount,
    /* littleEndian */ true,
  );
  return bytes;
}

const ASCII_STL = `solid cube
facet normal 0 0 0
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
endsolid cube
`;

function streamOf(bytes: Uint8Array): () => Promise<Uint8Array> {
  // A fresh copy per call — extractAttributes reads the stream more than once.
  return async () => bytes.slice();
}

module('Integration | stl file def', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  setupMockMatrix(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  async function loadBase() {
    let { StlDef } = await loader.import<any>('@cardstack/base/stl-file-def');
    let { extractStlFormat } = await loader.import<any>(
      '@cardstack/base/stl-meta-extractor',
    );
    let { FileContentMismatchError } = await loader.import<any>(
      '@cardstack/base/file-api',
    );
    return { StlDef, extractStlFormat, FileContentMismatchError };
  }

  test('extractStlFormat classifies a size-consistent binary STL', async function (assert) {
    let { extractStlFormat } = await loadBase();
    let bytes = binaryStl(1);
    let { format } = extractStlFormat(bytes, bytes.length);
    assert.strictEqual(format, 'binary');
  });

  test('extractStlFormat classifies an ASCII "solid" STL', async function (assert) {
    let { extractStlFormat } = await loadBase();
    let bytes = new TextEncoder().encode(ASCII_STL);
    let { format } = extractStlFormat(bytes, bytes.length);
    assert.strictEqual(format, 'ascii');
  });

  test('extractStlFormat rejects non-STL bytes', async function (assert) {
    let { extractStlFormat, FileContentMismatchError } = await loadBase();
    let bytes = new TextEncoder().encode('this is not an stl file');
    assert.throws(
      () => extractStlFormat(bytes, bytes.length),
      FileContentMismatchError,
    );
  });

  test('extractStlFormat does not misread ASCII whose size accidentally lacks a binary match', async function (assert) {
    let { extractStlFormat } = await loadBase();
    // Leading whitespace before `solid` still classifies as ASCII.
    let bytes = new TextEncoder().encode('   \n  solid part\nendsolid part\n');
    let { format } = extractStlFormat(bytes, bytes.length);
    assert.strictEqual(format, 'ascii');
  });

  test('StlDef.extractAttributes stamps format and inherits base fields (binary)', async function (assert) {
    let { StlDef } = await loadBase();
    let bytes = binaryStl(2);
    let url = `${testRealmURL}models/widget.stl`;
    let attrs = await StlDef.extractAttributes(url, streamOf(bytes), {});

    assert.strictEqual(attrs.format, 'binary', 'binary encoding detected');
    assert.strictEqual(attrs.name, 'widget.stl', 'inherits base name');
    assert.strictEqual(attrs.url, url, 'inherits url');
    assert.strictEqual(
      attrs.contentSize,
      bytes.length,
      'inherits base content size',
    );
  });

  test('StlDef.extractAttributes detects ASCII encoding', async function (assert) {
    let { StlDef } = await loadBase();
    let bytes = new TextEncoder().encode(ASCII_STL);
    let url = `${testRealmURL}models/cube.stl`;
    let attrs = await StlDef.extractAttributes(url, streamOf(bytes), {});
    assert.strictEqual(attrs.format, 'ascii');
  });

  test('StlDef.extractAttributes rejects a non-.stl extension', async function (assert) {
    let { StlDef, FileContentMismatchError } = await loadBase();
    let bytes = new TextEncoder().encode('# not stl');
    let url = `${testRealmURL}readme.md`;
    await assert.rejects(
      StlDef.extractAttributes(url, streamOf(bytes), {}),
      FileContentMismatchError,
    );
  });
});
