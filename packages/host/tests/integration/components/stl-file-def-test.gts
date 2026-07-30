// StlDef is a FileDef subclass for `.stl` 3D-print meshes. These tests exercise
// the real base modules loaded through the realm loader:
//
//   1. `extractStlMetadata` classifies binary vs ASCII from the first bytes plus
//      the file size, pulls the cheap header facts (binary triangle count, ASCII
//      solid name), and rejects non-STL bytes with FileContentMismatchError.
//   2. `StlDef.extractAttributes` stamps the tier-1 fields and inherits the base
//      name/contentType/size, and guards the file extension.

import { render } from '@ember/test-helpers';

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
    let { extractStlMetadata } = await loader.import<any>(
      '@cardstack/base/stl-meta-extractor',
    );
    let { FileContentMismatchError } = await loader.import<any>(
      '@cardstack/base/file-api',
    );
    return { StlDef, extractStlMetadata, FileContentMismatchError };
  }

  test('extractStlMetadata reads binary encoding and triangle count', async function (assert) {
    let { extractStlMetadata } = await loadBase();
    let bytes = binaryStl(3);
    let meta = extractStlMetadata(bytes, bytes.length);
    assert.strictEqual(meta.format, 'binary');
    assert.strictEqual(meta.triangleCount, 3, 'binary count from the header');
    assert.strictEqual(meta.solidName, undefined, 'binary has no solid name');
  });

  test('extractStlMetadata reads ASCII encoding and solid name', async function (assert) {
    let { extractStlMetadata } = await loadBase();
    let bytes = new TextEncoder().encode(ASCII_STL);
    let meta = extractStlMetadata(bytes, bytes.length);
    assert.strictEqual(meta.format, 'ascii');
    assert.strictEqual(meta.solidName, 'cube', 'name from the solid line');
    assert.strictEqual(
      meta.triangleCount,
      undefined,
      'ASCII count is left for the viewer, not scanned on the index path',
    );
  });

  test('extractStlMetadata rejects non-STL bytes', async function (assert) {
    let { extractStlMetadata, FileContentMismatchError } = await loadBase();
    let bytes = new TextEncoder().encode('this is not an stl file');
    assert.throws(
      () => extractStlMetadata(bytes, bytes.length),
      FileContentMismatchError,
    );
  });

  test('extractStlMetadata classifies whitespace-led ASCII and captures its name', async function (assert) {
    let { extractStlMetadata } = await loadBase();
    let bytes = new TextEncoder().encode('   \n  solid part\nendsolid part\n');
    let meta = extractStlMetadata(bytes, bytes.length);
    assert.strictEqual(meta.format, 'ascii');
    assert.strictEqual(meta.solidName, 'part');
  });

  test('StlDef.extractAttributes stamps tier-1 fields and inherits base (binary)', async function (assert) {
    let { StlDef } = await loadBase();
    let bytes = binaryStl(2);
    let url = `${testRealmURL}models/widget.stl`;
    let attrs = await StlDef.extractAttributes(url, streamOf(bytes), {});

    assert.strictEqual(attrs.format, 'binary', 'binary encoding detected');
    assert.strictEqual(attrs.triangleCount, 2, 'binary triangle count stamped');
    assert.strictEqual(attrs.name, 'widget.stl', 'inherits base name');
    assert.strictEqual(attrs.url, url, 'inherits url');
    assert.strictEqual(
      attrs.contentSize,
      bytes.length,
      'inherits base content size',
    );
  });

  test('StlDef.extractAttributes detects ASCII encoding and solid name', async function (assert) {
    let { StlDef } = await loadBase();
    let bytes = new TextEncoder().encode(ASCII_STL);
    let url = `${testRealmURL}models/cube.stl`;
    let attrs = await StlDef.extractAttributes(url, streamOf(bytes), {});
    assert.strictEqual(attrs.format, 'ascii');
    assert.strictEqual(attrs.solidName, 'cube');
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

  // With no file url there is nothing to render — the viewer shows its
  // source-unavailable fallback and never mounts a canvas host or triggers the
  // CDN three.js load. (Real WebGL rendering is verified out-of-band, since it
  // needs a browser with a GPU/SwiftShader.)
  test('ThreeModelViewer shows a fallback when no url is provided', async function (assert) {
    let mod = await loader.import<any>('@cardstack/base/three-model-viewer');
    let Viewer = mod.default;
    await render(
      <template><Viewer @fileType='stl' @name='model.stl' /></template>,
    );
    assert
      .dom('[data-test-three-fallback]')
      .exists('renders source-unavailable without a url');
    assert.dom('[data-test-three-canvas]').doesNotExist();
  });
});
