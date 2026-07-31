import { silhouettePath } from '@cardstack/base/model-file-def';
import { parseStl } from '@cardstack/base/stl-meta-extractor';
import { parseThreeMf } from '@cardstack/base/three-mf-meta-extractor';
import { zipSync, strToU8 } from 'fflate';
import { module, test } from 'qunit';

// These exercise the pure, index-time metadata extractors directly (no
// card-api/render harness needed) — they take an ArrayBuffer and return plain
// data. Inputs are built programmatically so the tests carry no binary fixtures.

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
  test('parses a binary STL: encoding, counts, and bounding box', function (assert) {
    let parsed = parseStl(buildBinaryStl([UNIT_TRIANGLE]));
    assert.ok(parsed, 'binary STL parses');
    assert.strictEqual(parsed!.stlMetadata.encoding, 'binary');
    assert.strictEqual(parsed!.stlMetadata.facetCount, 1);
    assert.strictEqual(parsed!.stlMetadata.normalCount, 1);
    assert.strictEqual(parsed!.stlMetadata.degenerateFacetCount, 0);
    assert.strictEqual(parsed!.model3d.triangles, 1);
    assert.strictEqual(parsed!.model3d.vertices, 3, '3 vertex records');
    assert.strictEqual(parsed!.model3d.meshes, 1);
    assert.strictEqual(parsed!.stlMetadata.sizeX, 1);
    assert.strictEqual(parsed!.stlMetadata.sizeY, 1);
    assert.strictEqual(parsed!.stlMetadata.sizeZ, 0);
    assert.false(parsed!.stlMetadata.hasColorData);
  });

  test('detects color via the attribute byte count', function (assert) {
    let parsed = parseStl(
      buildBinaryStl([{ ...UNIT_TRIANGLE, attributeByteCount: 0x8000 }]),
    );
    assert.true(parsed!.stlMetadata.hasColorData, 'color bit set');
    assert.strictEqual(parsed!.model3d.materials, 1);
  });

  test('detects color via a COLOR= binary header', function (assert) {
    let parsed = parseStl(buildBinaryStl([UNIT_TRIANGLE], 'COLOR=1.0 solid'));
    assert.true(parsed!.stlMetadata.hasColorData, 'COLOR= header');
  });

  test('counts a degenerate facet without misaligning the count', function (assert) {
    // First facet degenerate (all vertices identical), second is valid — the
    // streaming parser must attribute degeneracy to the right facet.
    let degenerate: BinaryTriangle = {
      normal: [0, 0, 0],
      vertices: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    };
    let parsed = parseStl(buildBinaryStl([degenerate, UNIT_TRIANGLE]));
    assert.strictEqual(parsed!.stlMetadata.facetCount, 2);
    assert.strictEqual(parsed!.stlMetadata.degenerateFacetCount, 1);
  });

  test('parses an ASCII STL: solid name and extents', function (assert) {
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
    assert.strictEqual(parsed!.stlMetadata.facetCount, 1);
    assert.strictEqual(parsed!.model3d.vertices, 3);
    assert.strictEqual(parsed!.stlMetadata.sizeX, 2);
    assert.strictEqual(parsed!.stlMetadata.sizeY, 4);
    assert.strictEqual(parsed!.stlMetadata.sizeZ, 0);
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
<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">My Cube</metadata>
  <metadata name="Designer">Alice</metadata>
  <metadata name="Application">TestApp</metadata>
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

module('Unit | model metadata extractors | parseThreeMf', function () {
  test('parses a minimal 3MF package', function (assert) {
    let parsed = parseThreeMf(
      buildThreeMf({ '3D/3dmodel.model': CUBE_MODEL_XML }),
    );
    assert.ok(parsed, '3MF parses');
    assert.strictEqual(parsed!.model3d.meshes, 1);
    assert.strictEqual(parsed!.model3d.vertices, 4, 'indexed unique vertices');
    assert.strictEqual(parsed!.model3d.triangles, 2);
    assert.strictEqual(parsed!.threeMfMetadata.unit, 'millimeter');
    assert.strictEqual(parsed!.threeMfMetadata.sizeX, 10);
    assert.strictEqual(parsed!.threeMfMetadata.sizeY, 20);
    assert.strictEqual(parsed!.threeMfMetadata.sizeZ, 30);
    assert.strictEqual(parsed!.threeMfMetadata.objectCount, 1);
    assert.strictEqual(parsed!.threeMfMetadata.buildItemCount, 1);
    assert.strictEqual(parsed!.threeMfMetadata.title, 'My Cube');
    assert.strictEqual(parsed!.threeMfMetadata.designer, 'Alice');
    assert.strictEqual(parsed!.threeMfMetadata.application, 'TestApp');
    // With no slicer config, print parts fall back to mesh objects.
    assert.strictEqual(parsed!.threeMfMetadata.printPartCount, 1);
    assert.strictEqual(parsed!.threeMfMetadata.printParts?.[0]?.faceCount, 2);
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

  test('returns undefined for malformed model XML', function (assert) {
    assert.strictEqual(
      parseThreeMf(buildThreeMf({ '3D/3dmodel.model': '<model><unclosed>' })),
      undefined,
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

module('Unit | model metadata extractors | silhouettePath', function () {
  test('emits one move+line segment per box edge and is deterministic', function (assert) {
    let path = silhouettePath(1, 1, 1);
    assert.strictEqual(
      (path.match(/M/g) ?? []).length,
      12,
      '12 edges of a box',
    );
    assert.ok(path.includes('L'), 'draws line segments');
    assert.strictEqual(path, silhouettePath(1, 1, 1), 'deterministic');
  });

  test('does not divide by zero for degenerate extents', function (assert) {
    assert.strictEqual(
      typeof silhouettePath(0, 0, 0),
      'string',
      'zero extents guarded',
    );
  });
});
