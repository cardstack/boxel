import { parseStl } from '@cardstack/base/stl-meta-extractor';
import { parseThreeMf } from '@cardstack/base/three-mf-meta-extractor';
import { zipSync, strToU8 } from 'fflate';
import { module, test } from 'qunit';

// These exercise the pure, index-time metadata extractors directly (no
// card-api/render harness needed) — they take an ArrayBuffer and return plain
// data. Inputs are built programmatically so the tests carry no binary fixtures.
//
// Both extractors are deliberately header-only: STL reads the fixed binary
// header (or the ASCII prologue) and 3MF reads the model part's metadata
// prologue. Neither scans geometry, so neither reports a bounding box or vertex/
// triangle counts — physical dimensions come from the live client-side viewer.

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  return u8.buffer.slice(
    u8.byteOffset,
    u8.byteOffset + u8.byteLength,
  ) as ArrayBuffer;
}

interface BinaryTriangle {
  normal: [number, number, number];
  vertices: [
    [number, number, number],
    [number, number, number],
    [number, number, number],
  ];
  attributeByteCount?: number;
}

// Build a well-formed binary STL: 80-byte header, uint32 facet count, then
// 50 bytes per facet (normal + 3 vertices + 2-byte attribute count).
function buildBinaryStl(
  triangles: BinaryTriangle[],
  header = 'binary stl fixture',
): ArrayBuffer {
  let buf = new ArrayBuffer(84 + triangles.length * 50);
  let view = new DataView(buf);
  let bytes = new Uint8Array(buf);
  bytes.set(new TextEncoder().encode(header).subarray(0, 80), 0);
  view.setUint32(80, triangles.length, true);
  let offset = 84;
  for (let tri of triangles) {
    view.setFloat32(offset, tri.normal[0], true);
    view.setFloat32(offset + 4, tri.normal[1], true);
    view.setFloat32(offset + 8, tri.normal[2], true);
    for (let v = 0; v < 3; v++) {
      let p = offset + 12 + v * 12;
      view.setFloat32(p, tri.vertices[v][0], true);
      view.setFloat32(p + 4, tri.vertices[v][1], true);
      view.setFloat32(p + 8, tri.vertices[v][2], true);
    }
    view.setUint16(offset + 48, tri.attributeByteCount ?? 0, true);
    offset += 50;
  }
  return buf;
}

const UNIT_TRIANGLE: BinaryTriangle = {
  normal: [0, 0, 1],
  vertices: [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ],
};

module('Unit | model metadata extractors | parseStl', function () {
  test('reads the binary STL header: encoding and facet count', function (assert) {
    let parsed = parseStl(buildBinaryStl([UNIT_TRIANGLE, UNIT_TRIANGLE]));
    assert.ok(parsed, 'binary STL parses');
    assert.strictEqual(parsed!.stlMetadata.encoding, 'binary');
    // Facet count comes straight from the header's uint32 — no facet scan.
    assert.strictEqual(parsed!.stlMetadata.facetCount, 2);
    assert.false(parsed!.stlMetadata.hasColorData);
    // No geometry scan → no bounding box on the extracted metadata.
    assert.notOk(
      (parsed!.stlMetadata as unknown as Record<string, unknown>).sizeX,
      'no index-time size',
    );
  });

  test('detects color via a COLOR= binary header', function (assert) {
    let parsed = parseStl(buildBinaryStl([UNIT_TRIANGLE], 'COLOR=1.0 solid'));
    assert.true(parsed!.stlMetadata.hasColorData, 'COLOR= header');
  });

  test('parses an ASCII STL: encoding and solid name', function (assert) {
    let ascii = [
      'solid mycube',
      ' facet normal 0 0 1',
      '  outer loop',
      '   vertex 0 0 0',
      '   vertex 2 0 0',
      '   vertex 0 4 0',
      '  endloop',
      ' endfacet',
      'endsolid mycube',
    ].join('\n');
    let parsed = parseStl(toArrayBuffer(new TextEncoder().encode(ascii)));
    assert.ok(parsed, 'ASCII STL parses');
    assert.strictEqual(parsed!.stlMetadata.encoding, 'ASCII');
    assert.strictEqual(parsed!.stlMetadata.solidName, 'mycube');
    // ASCII carries no facet count in its head, and we never scan the body.
    assert.strictEqual(parsed!.stlMetadata.facetCount, undefined);
  });

  test('returns undefined for non-STL content', function (assert) {
    assert.strictEqual(
      parseStl(toArrayBuffer(new TextEncoder().encode('just some text'))),
      undefined,
    );
    assert.strictEqual(parseStl(new ArrayBuffer(0)), undefined, 'empty buffer');
  });
});

// Minimal OPC/3MF package builder: a ZIP whose entries are the model XML and
// (optionally) a slicer config, produced with fflate — the same library the
// parser uses to unzip.
function buildThreeMf(entries: Record<string, string>): ArrayBuffer {
  let files: Record<string, Uint8Array> = {};
  for (let [path, text] of Object.entries(entries)) {
    files[path] = strToU8(text);
  }
  return toArrayBuffer(zipSync(files));
}

const CUBE_MODEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
  <metadata name="Title">My Cube &amp; Co</metadata>
  <metadata name="Designer">Alice</metadata>
  <metadata name="Application">TestApp</metadata>
  <resources>
    <basematerials id="1">
      <base name="PLA Black" displaycolor="#101010FF"/>
      <base name="PLA Red" displaycolor="#FF0000FF"/>
    </basematerials>
    <object id="2" type="model" name="Cube">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0"/>
          <vertex x="10" y="0" z="0"/>
        </vertices>
      </mesh>
    </object>
  </resources>
  <build><item objectid="2"/></build>
</model>`;

module('Unit | model metadata extractors | parseThreeMf', function () {
  test('reads the 3MF metadata prologue', function (assert) {
    let parsed = parseThreeMf(
      buildThreeMf({ '3D/3dmodel.model': CUBE_MODEL_XML }),
    );
    assert.ok(parsed, '3MF parses');
    assert.strictEqual(parsed!.threeMfMetadata.unit, 'millimeter');
    assert.strictEqual(parsed!.threeMfMetadata.language, 'en-US');
    // Values are XML-entity-decoded.
    assert.strictEqual(parsed!.threeMfMetadata.title, 'My Cube & Co');
    assert.strictEqual(parsed!.threeMfMetadata.designer, 'Alice');
    assert.strictEqual(parsed!.threeMfMetadata.application, 'TestApp');
    assert.deepEqual(parsed!.threeMfMetadata.materialNames, [
      'PLA Black',
      'PLA Red',
    ]);
    assert.strictEqual(parsed!.threeMfMetadata.extensionCount, 1);
    // No geometry parse → no bounding box, no object/vertex counts.
    assert.notOk(
      (parsed!.threeMfMetadata as Record<string, unknown>).sizeX,
      'no index-time size',
    );
    assert.notOk(
      (parsed!.threeMfMetadata as Record<string, unknown>).objectCount,
      'no geometry counts',
    );
    // No slicer config → no print parts (we no longer fall back to geometry).
    assert.strictEqual(parsed!.threeMfMetadata.printPartCount, undefined);
  });

  test('reads slicer config parts, plates, and extruders', function (assert) {
    let config = `<?xml version="1.0"?>
<config>
  <plate><metadata key="plater_id" value="1"/></plate>
  <part id="1">
    <metadata key="name" value="Widget"/>
    <metadata key="extruder" value="2"/>
    <mesh_stat face_count="1234"/>
  </part>
</config>`;
    let parsed = parseThreeMf(
      buildThreeMf({
        '3D/3dmodel.model': CUBE_MODEL_XML,
        'Metadata/model_settings.config': config,
      }),
    );
    assert.strictEqual(parsed!.threeMfMetadata.plateCount, 1);
    assert.strictEqual(parsed!.threeMfMetadata.printPartCount, 1);
    assert.strictEqual(parsed!.threeMfMetadata.extruderCount, 1);
    assert.strictEqual(parsed!.threeMfMetadata.configuredFaceCount, 1234);
    let part = parsed!.threeMfMetadata.printParts?.[0];
    assert.strictEqual(part?.name, 'Widget');
    assert.strictEqual(part?.extruder, 2);
    assert.strictEqual(part?.faceCount, 1234);
  });

  test('rejects well-formed XML that is not a 3MF core model', function (assert) {
    // The negative space around the format check: a `.model`-named XML file
    // whose root is not the 3MF `<model>` core element must NOT be accepted.
    assert.strictEqual(
      parseThreeMf(buildThreeMf({ '3D/3dmodel.model': '<document/>' })),
      undefined,
      'unrelated root rejected',
    );
    assert.strictEqual(
      parseThreeMf(
        buildThreeMf({
          '3D/3dmodel.model':
            '<model xmlns="http://example.com/other"><resources/></model>',
        }),
      ),
      undefined,
      'wrong namespace rejected',
    );
  });

  test('returns undefined for a package with no model part', function (assert) {
    assert.strictEqual(
      parseThreeMf(buildThreeMf({ 'random.txt': 'hello' })),
      undefined,
    );
  });

  test('returns undefined for a non-ZIP payload', function (assert) {
    assert.strictEqual(
      parseThreeMf(toArrayBuffer(new TextEncoder().encode('not a zip'))),
      undefined,
    );
  });
});
