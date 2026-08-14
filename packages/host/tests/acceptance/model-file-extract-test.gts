import { visit, waitUntil } from '@ember/test-helpers';

import { zipSync, strToU8 } from 'fflate';
import { module, test } from 'qunit';

import {
  baseRealm,
  type FileExtractResponse,
  type RenderRouteOptions,
  type ResolvedCodeRef,
  type RealmResourceIdentifier,
} from '@cardstack/runtime-common';

import {
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  testRealmURL,
  setupAcceptanceTestRealm,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  withCachedRealmSetup,
} from '../helpers';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { setupApplicationTest } from '../helpers/setup';

// End-to-end coverage of the StlDef / ThreeMfDef extract chain through the real
// render/file-extract route (the path the indexer drives): a file is served
// from the test realm, the route runs the leaf `extractAttributes`, and the
// resulting file-meta search doc carries the parsed facts on the shared
// `model3d` field. The pure parsers are unit-tested separately in
// `unit/model-meta-extractor-test.ts`; this proves the full round-trip, the
// base-realm code-ref resolution, and the projection onto `model3d`.

// One ASCII STL facet — the realm serves it as text, StlDef parses it.
const CUBE_STL = [
  'solid testcube',
  ' facet normal 0 0 1',
  '  outer loop',
  '   vertex 0 0 0',
  '   vertex 2 0 0',
  '   vertex 0 4 0',
  '  endloop',
  ' endfacet',
  'endsolid testcube',
].join('\n');

const CUBE_MODEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Round-trip Cube</metadata>
  <metadata name="Designer">Test</metadata>
  <resources>
    <object id="1" type="model" name="Cube">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="10" y="0" z="0"/>
          <vertex x="0" y="20" z="0"/>
          <vertex x="0" y="0" z="30"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="1" v3="2"/>
          <triangle v1="0" v2="1" v3="3"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build><item objectid="1"/></build>
</model>`;

// A real OPC/3MF package (binary ZIP) stored as bytes in the realm.
const CUBE_3MF = zipSync({ '3D/3dmodel.model': strToU8(CUBE_MODEL_XML) });

module('Acceptance | model file-extract', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
  });

  const renderPath = (
    url: string,
    renderOptions: RenderRouteOptions,
    nonce = 0,
  ) =>
    `/render/${encodeURIComponent(url)}/${nonce}/${encodeURIComponent(
      JSON.stringify(renderOptions),
    )}/file-extract`;

  const baseFileDefCodeRef = (name: string): ResolvedCodeRef => ({
    module: `${baseRealm.url}${
      name === 'StlDef' ? 'stl-model-def' : 'three-mf-def'
    }` as RealmResourceIdentifier,
    name,
  });

  const fileURL = (path: string) => new URL(path, testRealmURL).href;

  async function captureFileExtractResult(
    expectedStatus?: 'ready' | 'error',
  ): Promise<FileExtractResponse> {
    await waitUntil(
      () => {
        let container = document.querySelector(
          '[data-prerender-file-extract]',
        ) as HTMLElement | null;
        let status = container?.getAttribute(
          'data-prerender-file-extract-status',
        );
        if (!status) {
          return false;
        }
        if (expectedStatus && status !== expectedStatus) {
          return false;
        }
        return status === 'ready' || status === 'error';
      },
      { timeout: 5000 },
    );
    let container = document.querySelector(
      '[data-prerender-file-extract]',
    ) as HTMLElement | null;
    let text = container?.querySelector('pre')?.textContent?.trim() ?? '';
    return JSON.parse(text) as FileExtractResponse;
  }

  hooks.beforeEach(async function () {
    await withCachedRealmSetup(async () => {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'cube.stl': CUBE_STL,
          'cube.3mf': CUBE_3MF,
          'notmodel.stl': 'this is not an STL file',
        },
      });
    });
  });

  test('extracts STL facts onto model3d through the render route', async function (assert) {
    await visit(
      renderPath(fileURL('cube.stl'), {
        fileExtract: true,
        fileDefCodeRef: baseFileDefCodeRef('StlDef'),
      }),
    );
    let result = await captureFileExtractResult('ready');
    let doc = result.searchDoc as Record<string, any>;
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(doc?.model3d?.format, 'ASCII STL');
    assert.strictEqual(doc?.model3d?.solidName, 'testcube');
    // An STL is exactly one solid, so `meshes` is always 1 — this also keeps the
    // isolated shell's `3D model` section visible for ASCII STL.
    assert.strictEqual(doc?.model3d?.meshes, 1);
    // Header-only sniff: an ASCII STL carries no facet count, and dimensions
    // come from the client-side viewer, never the index.
    assert.strictEqual(
      doc?.model3d?.triangles,
      undefined,
      'no ASCII facet count',
    );
    assert.strictEqual(
      doc?.model3d?.hasColorData,
      undefined,
      'no color data (false is pruned)',
    );
  });

  test('extracts 3MF facts onto model3d through the render route', async function (assert) {
    await visit(
      renderPath(fileURL('cube.3mf'), {
        fileExtract: true,
        fileDefCodeRef: baseFileDefCodeRef('ThreeMfDef'),
      }),
    );
    let result = await captureFileExtractResult('ready');
    let doc = result.searchDoc as Record<string, any>;
    assert.strictEqual(result.status, 'ready');
    assert.strictEqual(doc?.model3d?.format, '3MF package');
    assert.strictEqual(doc?.model3d?.unit, 'millimeter');
    assert.strictEqual(doc?.model3d?.designer, 'Test');
    // Bounded prologue read: geometry counts come only from a slicer config,
    // which this minimal package has none of.
    assert.strictEqual(
      doc?.model3d?.triangles,
      undefined,
      'no geometry counts without slicer config',
    );
  });

  test('a .stl whose bytes are not STL falls back and marks mismatch', async function (assert) {
    await visit(
      renderPath(fileURL('notmodel.stl'), {
        fileExtract: true,
        fileDefCodeRef: baseFileDefCodeRef('StlDef'),
      }),
    );
    let result = await captureFileExtractResult('ready');
    let doc = result.searchDoc as Record<string, any>;
    assert.strictEqual(result.status, 'ready', 'still indexes as base file');
    assert.true(result.mismatch, 'sets mismatch flag');
    assert.strictEqual(doc?.model3d, undefined, 'no 3D metadata on fallback');
  });
});
