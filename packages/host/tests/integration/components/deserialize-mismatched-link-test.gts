// A link field's target lives in another document, and its index row can be
// wrong independently of the card that links to it — a file the indexer
// misclassified serializes with the wrong adoptsFrom, so it rehydrates as a
// type the field does not accept. Deserialization drops such a target (with a
// warning) instead of failing the whole document: one bad row in a linked
// realm must not make every card that references it unloadable. Direct
// assignment keeps strict validation.

import { module, test } from 'qunit';

import { baseRRI } from '@cardstack/runtime-common';

import {
  setupBaseRealm,
  createFromSerialized,
  FileDef,
} from '../../helpers/base-realm';
import { setupRenderingTest } from '../../helpers/setup';

const REALM = 'https://test-realm/';

function fileMetaResource(
  id: string,
  adoptsFrom: { module: string; name: string },
  attributes: Record<string, unknown> = {},
) {
  return {
    id,
    type: 'file-meta' as const,
    attributes: {
      name: id.split('/').pop(),
      url: id,
      sourceUrl: id,
      contentType: 'text/markdown',
      ...attributes,
    },
    meta: { adoptsFrom },
    links: { self: id },
  };
}

module('Integration | deserialize mismatched link', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  function systemCardDoc() {
    let goodSkill = fileMetaResource(
      `${REALM}skill.md`,
      { module: baseRRI('markdown-file-def'), name: 'MarkdownDef' },
      { kind: 'skill' },
    );
    // The shape a misclassified index row serves: the file rehydrates as a
    // plain FileDef, which does not satisfy linksToMany(MarkdownDef).
    let misclassifiedSkill = fileMetaResource(`${REALM}index.md`, {
      module: baseRRI('card-api'),
      name: 'FileDef',
    });
    let resource = {
      id: `${REALM}SystemCard/default`,
      type: 'card' as const,
      attributes: { title: 'Default System Configuration' },
      relationships: {
        'defaultSkillFiles.0': {
          links: { self: misclassifiedSkill.id },
          data: { type: 'file-meta', id: misclassifiedSkill.id },
        },
        'defaultSkillFiles.1': {
          links: { self: goodSkill.id },
          data: { type: 'file-meta', id: goodSkill.id },
        },
      },
      meta: {
        adoptsFrom: { module: baseRRI('system-card'), name: 'SystemCard' },
      },
    };
    return {
      resource,
      doc: { data: resource, included: [misclassifiedSkill, goodSkill] },
    };
  }

  test('a linksToMany target that does not satisfy the field type is dropped, not fatal', async function (assert) {
    let { resource, doc } = systemCardDoc();

    let instance: any = await createFromSerialized(
      resource as any,
      doc as any,
      undefined,
    );

    assert.ok(instance, 'the document deserializes despite the bad target');
    assert.strictEqual(
      instance.defaultSkillFiles.length,
      1,
      'the mismatched target is dropped',
    );
    assert.strictEqual(
      instance.defaultSkillFiles[0]?.sourceUrl,
      `${REALM}skill.md`,
      'the conforming target survives',
    );
  });

  test('direct assignment of a mismatched link still throws', async function (assert) {
    let { resource, doc } = systemCardDoc();
    let instance: any = await createFromSerialized(
      resource as any,
      doc as any,
      undefined,
    );
    let plainFile = new FileDef({
      id: `${REALM}note.txt`,
      name: 'note.txt',
      contentType: 'text/plain',
    });

    assert.throws(
      () => {
        instance.defaultSkillFiles = [plainFile];
      },
      /field validation error/,
      'user-set values keep strict validation',
    );
  });
});
