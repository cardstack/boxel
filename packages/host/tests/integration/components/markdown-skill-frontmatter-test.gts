// A skill is markdown with `boxel.kind: skill` frontmatter, modeled by the
// FrontmatterField / SkillFrontmatterField field types on MarkdownDef. These
// tests exercise the real MarkdownDef:
//
//   1. parseFrontmatter pulls the YAML block off the top of the body.
//   2. MarkdownDef.extractAttributes parses frontmatter, writes a direct
//      searchable `kind`, captures the whole frontmatter in
//      `frontmatter.rawContent`, and routes the per-field subclass marker
//      (SkillFrontmatterField) via the file-field-meta symbol.
//   3. The write→read round-trip (extractor lift → buildFileResource →
//      createFromSerialized) rehydrates `frontmatter` as a SkillFrontmatterField
//      with its commands intact.
//   4. Plain markdown (no frontmatter) is unaffected.

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, identifyCard } from '@cardstack/runtime-common';
import type { Loader } from '@cardstack/runtime-common/loader';

import { buildFileResource } from '@cardstack/host/utils/file-def-attributes-extractor';

import { setupLocalIndexing, testRealmURL } from '../../helpers';
import { setupBaseRealm, createFromSerialized } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

const FILE_FIELD_META = Symbol.for('boxel:file-field-meta');

let loader: Loader;

// Minimal getStream for extractAttributes: hand back the markdown bytes.
function streamOf(markdown: string): () => Promise<Uint8Array> {
  return async () => new TextEncoder().encode(markdown);
}

const SKILL_MD = `---
name: Realm Sync
description: Sync workspace files
boxel:
  kind: skill
  commands:
    - codeRef:
        module: '@cardstack/boxel-host/commands/realm-sync'
        name: SyncCommand
      requiresApproval: true
---
# Realm Sync

Body paragraph.
`;

module('Integration | markdown skill frontmatter', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);
  setupMockMatrix(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  async function loadBase() {
    let { MarkdownDef } = await loader.import<any>(
      `${baseRealm.url}markdown-file-def`,
    );
    let { SkillFrontmatterField } = await loader.import<any>(
      `${baseRealm.url}skill-frontmatter-field`,
    );
    let { FrontmatterField } = await loader.import<any>(
      `${baseRealm.url}frontmatter-field`,
    );
    let { parseFrontmatter } = await loader.import<any>(
      `${baseRealm.url}frontmatter-parse`,
    );
    return {
      MarkdownDef,
      SkillFrontmatterField,
      FrontmatterField,
      parseFrontmatter,
    };
  }

  test('parseFrontmatter splits the YAML block from the body', async function (assert) {
    let { parseFrontmatter } = await loadBase();
    let { data, body } = parseFrontmatter(SKILL_MD);
    assert.strictEqual(data.name, 'Realm Sync', 'top-level name parsed');
    assert.strictEqual((data.boxel as any).kind, 'skill', 'boxel.kind parsed');
    assert.strictEqual(
      (data.boxel as any).commands[0].codeRef.name,
      'SyncCommand',
      'nested boxel.commands codeRef parsed',
    );
    assert.true(
      body.startsWith('# Realm Sync'),
      'body excludes the frontmatter block',
    );

    let plain = parseFrontmatter('# Just markdown\n\nNo frontmatter.');
    assert.deepEqual(plain.data, {}, 'no frontmatter -> empty data');
    assert.strictEqual(
      plain.body,
      '# Just markdown\n\nNo frontmatter.',
      'no frontmatter -> body verbatim',
    );
  });

  test('extractAttributes surfaces searchable kind, raw frontmatter, and routes the SkillFrontmatterField marker', async function (assert) {
    let { MarkdownDef, SkillFrontmatterField } = await loadBase();
    let url = `${testRealmURL}skills/realm-sync/SKILL.md`;
    let attrs = await MarkdownDef.extractAttributes(
      url,
      streamOf(SKILL_MD),
      {},
    );

    assert.strictEqual(attrs.kind, 'skill', 'direct searchable kind written');
    assert.true(
      attrs.content.startsWith('# Realm Sync'),
      'content is the body — the frontmatter block is stripped',
    );
    assert.notOk(
      attrs.content.includes('boxel:'),
      'content excludes the raw frontmatter',
    );
    assert.strictEqual(
      attrs.frontmatter.rawContent.boxel.kind,
      'skill',
      'rawContent holds the whole frontmatter (incl. boxel namespace)',
    );
    assert.strictEqual(
      attrs.frontmatter.rawContent.name,
      'Realm Sync',
      'rawContent includes shared top-level keys',
    );
    assert.strictEqual(
      attrs.frontmatter.name,
      'Realm Sync',
      'typed name sourced from shared top-level name',
    );
    assert.true(
      attrs.frontmatter.commands[0].requiresApproval,
      'typed commands sourced from the boxel namespace',
    );

    let routed = (attrs as Record<PropertyKey, any>)[FILE_FIELD_META];
    assert.deepEqual(
      routed?.frontmatter?.adoptsFrom,
      identifyCard(SkillFrontmatterField),
      'routed per-field meta points frontmatter at SkillFrontmatterField',
    );
  });

  test('write -> read round-trip rehydrates frontmatter as SkillFrontmatterField with commands', async function (assert) {
    let { MarkdownDef, SkillFrontmatterField } = await loadBase();
    let url = `${testRealmURL}skills/realm-sync/SKILL.md`;
    let attrs = await MarkdownDef.extractAttributes(
      url,
      streamOf(SKILL_MD),
      {},
    );

    // Mirror what the file extractor does: lift the routed field meta out of
    // the flat searchDoc and thread it into the resource's meta.fields.
    let cleaned: Record<string, any> = { ...attrs };
    let cleanedBag = cleaned as Record<PropertyKey, any>;
    let fieldsMeta = cleanedBag[FILE_FIELD_META];
    delete cleanedBag[FILE_FIELD_META];

    let resource = buildFileResource(
      url,
      cleaned,
      identifyCard(MarkdownDef)!,
      undefined,
      fieldsMeta,
    );
    assert.deepEqual(
      (resource.meta as any).fields?.frontmatter?.adoptsFrom,
      identifyCard(SkillFrontmatterField),
      'buildFileResource now threads meta.fields (gap closed)',
    );

    let instance: any = await createFromSerialized(
      resource as any,
      { data: resource } as any,
      undefined,
    );
    assert.true(
      instance.frontmatter instanceof SkillFrontmatterField,
      'frontmatter rehydrated as SkillFrontmatterField subclass',
    );
    assert.strictEqual(
      instance.frontmatter.name,
      'Realm Sync',
      'typed subclass field survives round-trip',
    );
    assert.strictEqual(
      instance.frontmatter.rawContent.boxel.kind,
      'skill',
      'rawContent survives round-trip',
    );
    assert.strictEqual(
      instance.frontmatter.commands.length,
      1,
      'commands survive round-trip',
    );
    assert.strictEqual(
      instance.frontmatter.commands[0].codeRef.name,
      'SyncCommand',
      'command codeRef survives round-trip',
    );
  });

  test('plain markdown (no frontmatter) carries no kind and no frontmatter value', async function (assert) {
    let { MarkdownDef } = await loadBase();
    let url = `${testRealmURL}notes/readme.md`;
    let attrs = await MarkdownDef.extractAttributes(
      url,
      streamOf('# Readme\n\nHello.'),
      {},
    );
    assert.strictEqual(attrs.kind, undefined, 'no kind for plain markdown');
    assert.strictEqual(
      attrs.frontmatter,
      undefined,
      'no frontmatter value for plain markdown',
    );
    assert.strictEqual(
      (attrs as Record<PropertyKey, any>)[FILE_FIELD_META],
      undefined,
      'no routed field meta for plain markdown',
    );
    assert.strictEqual(attrs.title, 'Readme', 'title still extracted');
    assert.true(attrs.content.includes('Hello.'), 'content still extracted');
  });
});
