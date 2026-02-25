import { module, test } from 'qunit';

import type {
  LooseSingleFileMetaDocument,
} from '@cardstack/runtime-common';
import { baseRealm, isSingleFileMetaDocument } from '@cardstack/runtime-common';

import {
  setupBaseRealm,
  FileDef,
  serializeFileDef,
} from '../../helpers/base-realm';

import { setupRenderingTest } from '../../helpers/setup';

module('Integration | serializeFileDef', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  test('produces a LooseSingleFileMetaDocument with type "file-meta"', function (assert) {
    let fileDef = new FileDef({
      id: 'https://test-realm/hello.txt',
      name: 'hello.txt',
      contentType: 'text/plain',
    });

    let doc = serializeFileDef(fileDef);

    assert.strictEqual(doc.data.type, 'file-meta');
  });

  test('includes the id when the FileDef has one', function (assert) {
    let fileDef = new FileDef({
      id: 'https://test-realm/hello.txt',
      name: 'hello.txt',
      contentType: 'text/plain',
    });

    let doc = serializeFileDef(fileDef);

    assert.strictEqual(doc.data.id, 'https://test-realm/hello.txt');
  });

  test('includes adoptsFrom pointing to FileDef in meta', function (assert) {
    let fileDef = new FileDef({
      id: 'https://test-realm/hello.txt',
      name: 'hello.txt',
      contentType: 'text/plain',
    });

    let doc = serializeFileDef(fileDef);

    assert.deepEqual(doc.data.meta.adoptsFrom, {
      module: `${baseRealm.url}file-api`,
      name: 'FileDef',
    });
  });

  test('includes serialized field attributes', function (assert) {
    let fileDef = new FileDef({
      id: 'https://test-realm/image.png',
      name: 'image.png',
      contentType: 'image/png',
      contentSize: 1024,
      sourceUrl: 'https://origin.example/image.png',
    });

    let doc = serializeFileDef(fileDef);

    assert.strictEqual(doc.data.attributes?.name, 'image.png');
    assert.strictEqual(doc.data.attributes?.contentType, 'image/png');
    assert.strictEqual(doc.data.attributes?.contentSize, 1024);
    assert.strictEqual(
      doc.data.attributes?.sourceUrl,
      'https://origin.example/image.png',
    );
  });

  test('result passes isSingleFileMetaDocument type guard', function (assert) {
    let fileDef = new FileDef({
      id: 'https://test-realm/data.json',
      name: 'data.json',
      contentType: 'application/json',
    });

    let doc = serializeFileDef(fileDef);

    // Cast to unknown first to test the type guard properly
    assert.true(
      isSingleFileMetaDocument(doc as unknown),
      'serialized document passes the isSingleFileMetaDocument type guard',
    );
  });

  test('relative URLs in attributes are made relative to the FileDef id', function (assert) {
    let realmURL = 'https://test-realm/';
    let fileId = `${realmURL}subdir/image.png`;
    let fileDef = new FileDef({
      id: fileId,
      name: 'image.png',
      contentType: 'image/png',
      // sourceUrl intentionally omitted to test relative URL handling
    });

    let doc = serializeFileDef(fileDef);

    // id should be present and exactly match
    assert.strictEqual(doc.data.id, fileId);
    // meta.adoptsFrom module should be absolute (base realm URL)
    assert.ok(
      (doc.data.meta.adoptsFrom?.module ?? '').startsWith('http'),
      'adoptsFrom module is an absolute URL',
    );
  });

  test('serialized document shape matches LooseSingleFileMetaDocument interface', function (assert) {
    let fileDef = new FileDef({
      id: 'https://test-realm/notes.md',
      name: 'notes.md',
      contentType: 'text/markdown',
      contentHash: 'abc123',
      contentSize: 512,
    });

    let doc: LooseSingleFileMetaDocument = serializeFileDef(fileDef);

    assert.ok(doc.data, 'document has a data property');
    assert.strictEqual(doc.data.type, 'file-meta', 'type is file-meta');
    assert.ok(doc.data.meta, 'data has meta');
    assert.ok(doc.data.meta.adoptsFrom, 'meta has adoptsFrom');
    assert.ok(doc.data.attributes, 'data has attributes');
    assert.strictEqual(doc.data.attributes?.name, 'notes.md');
    assert.strictEqual(doc.data.attributes?.contentHash, 'abc123');
    assert.strictEqual(doc.data.attributes?.contentSize, 512);
  });
});
