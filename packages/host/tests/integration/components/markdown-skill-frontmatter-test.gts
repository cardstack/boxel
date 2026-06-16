// CS-11545 — a skill is markdown with `kind: skill` frontmatter, not a SkillDef
// subclass. These tests exercise the real MarkdownDef + SkillField:
//
//   1. parseFrontmatter pulls the YAML block off the top of the body.
//   2. MarkdownDef.extractAttributes parses frontmatter, writes a flat
//      searchable `kind`, carries the nested `frontmatter` value, and routes the
//      per-field subclass marker (SkillField) via the file-field-meta symbol.
//   3. The write→read round-trip (extractor lift → buildFileResource →
//      createFromSerialized) rehydrates `frontmatter` as a SkillField with its
//      commands intact — closing the write-path gap the CS-11568 spike pinned.
//   4. Plain markdown (no frontmatter) is unaffected.
//
// NOTE: requires the host test-services stack / CI to run (local host-test boot
// is documented-broken). Authored against the harness conventions in
// spike-cs-11568-filedef-poly-test.gts.

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

module(
  'Integration | CS-11545 | markdown skill frontmatter',
  function (hooks) {
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
      let { SkillField } = await loader.import<any>(
        `${baseRealm.url}skill-field`,
      );
      let { BoxelFrontmatterField } = await loader.import<any>(
        `${baseRealm.url}boxel-frontmatter-field`,
      );
      let { parseFrontmatter } = await loader.import<any>(
        `${baseRealm.url}frontmatter-parse`,
      );
      return { MarkdownDef, SkillField, BoxelFrontmatterField, parseFrontmatter };
    }

    test('parseFrontmatter splits the YAML block from the body', async function (assert) {
      let { parseFrontmatter } = await loadBase();
      let { data, body } = parseFrontmatter(SKILL_MD);
      assert.strictEqual(data.name, 'Realm Sync', 'top-level name parsed');
      assert.strictEqual(
        (data.boxel as any).kind,
        'skill',
        'boxel.kind parsed',
      );
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

    test('extractAttributes surfaces flat kind, nested frontmatter, and routes the SkillField marker', async function (assert) {
      let { MarkdownDef, SkillField } = await loadBase();
      let url = `${testRealmURL}skills/realm-sync/SKILL.md`;
      let attrs = await MarkdownDef.extractAttributes(url, streamOf(SKILL_MD), {});

      assert.strictEqual(attrs.kind, 'skill', 'flat searchable kind written');
      assert.strictEqual(
        attrs.description,
        'Sync workspace files',
        'flat searchable description written',
      );
      assert.strictEqual(
        attrs.boxel.name,
        'Realm Sync',
        'boxel.name sourced from shared top-level name',
      );
      assert.strictEqual(
        attrs.boxel.commands[0].requiresApproval,
        true,
        'nested boxel.command survives extraction',
      );

      let routed = (attrs as Record<PropertyKey, any>)[FILE_FIELD_META];
      assert.deepEqual(
        routed?.boxel?.adoptsFrom,
        identifyCard(SkillField),
        'routed per-field meta points boxel at SkillField',
      );
    });

    test('write -> read round-trip rehydrates frontmatter as SkillField with commands', async function (assert) {
      let { MarkdownDef, SkillField } = await loadBase();
      let url = `${testRealmURL}skills/realm-sync/SKILL.md`;
      let attrs = await MarkdownDef.extractAttributes(url, streamOf(SKILL_MD), {});

      // Mirror what the file extractor does: lift the routed field meta out of
      // the flat searchDoc and thread it into the resource's meta.fields.
      let cleaned: Record<string, any> = { ...attrs };
      let fieldsMeta = cleaned[FILE_FIELD_META];
      delete cleaned[FILE_FIELD_META];

      let resource = buildFileResource(
        url,
        cleaned,
        identifyCard(MarkdownDef)!,
        undefined,
        fieldsMeta,
      );
      assert.deepEqual(
        (resource.meta as any).fields?.boxel?.adoptsFrom,
        identifyCard(SkillField),
        'buildFileResource now threads meta.fields (gap closed)',
      );

      let instance: any = await createFromSerialized(
        resource as any,
        { data: resource } as any,
        undefined,
      );
      assert.true(
        instance.boxel instanceof SkillField,
        'boxel rehydrated as SkillField subclass',
      );
      assert.strictEqual(
        instance.boxel.name,
        'Realm Sync',
        'subclass field survives round-trip',
      );
      assert.strictEqual(
        instance.boxel.commands.length,
        1,
        'commands survive round-trip',
      );
      assert.strictEqual(
        instance.boxel.commands[0].codeRef.name,
        'SyncCommand',
        'command codeRef survives round-trip',
      );
    });

    test('plain markdown (no frontmatter) carries no kind and no routed meta', async function (assert) {
      let { MarkdownDef } = await loadBase();
      let url = `${testRealmURL}notes/readme.md`;
      let attrs = await MarkdownDef.extractAttributes(
        url,
        streamOf('# Readme\n\nHello.'),
        {},
      );
      assert.strictEqual(attrs.kind, undefined, 'no kind for plain markdown');
      assert.strictEqual(
        (attrs as Record<PropertyKey, any>)[FILE_FIELD_META],
        undefined,
        'no routed field meta for plain markdown',
      );
      assert.strictEqual(attrs.title, 'Readme', 'title still extracted');
      assert.true(
        attrs.content.includes('Hello.'),
        'content still extracted',
      );
    });
  },
);
