// SPIKE CS-11568 — POC: can a FileDef subclass carry a nested polymorphic
// FieldDef value (a `contains(BaseField)` whose concrete instance is a SUBCLASS
// that itself holds a `containsMany(...)`) and round-trip through the platform's
// serialize → deserialize machinery the way CardDef already can?
//
// This file is a throwaway proof-of-concept for the spike, not production code.
//
// It proves two distinct things:
//
//   1. READ HALF (platform capability): given a FileMetaResource that carries
//      `meta.fields.<name>.adoptsFrom` (the per-field concrete-subclass marker),
//      `createFromSerialized` rehydrates the FileDef subclass instance with the
//      polymorphic field as the correct SUBCLASS and the nested containsMany
//      array intact. `serializeFileDef` PRODUCES that meta.fields when given a
//      live subclass instance. So the full serialize→deserialize loop works for
//      FileDef exactly as it does for CardDef (cf. serialization-test.gts:3013).
//
//   2. WRITE-PATH GAP (the actual blocker): the INDEXING write path does NOT go
//      through serializeFileDef. It hand-builds the resource via
//      `buildFileResource` (host/app/utils/file-def-attributes-extractor.ts:399)
//      from the flat POJO returned by `extractAttributes`. That function emits
//      only top-level `meta.adoptsFrom` and never `meta.fields`. So an indexed
//      FileDef row would deserialize the polymorphic field as the BASE class,
//      losing the subclass identity (the nested data may survive as loose
//      attributes, but the concrete type marker is gone).

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { LooseSingleCardDocument } from '@cardstack/runtime-common';
import { baseRealm } from '@cardstack/runtime-common';

import type { Loader } from '@cardstack/runtime-common/loader';

import { buildFileResource } from '@cardstack/host/utils/file-def-attributes-extractor';

import { setupLocalIndexing, testRealmURL, testRRI } from '../../helpers';
import {
  setupBaseRealm,
  contains,
  containsMany,
  FileDef,
  FieldDef,
  StringField,
  field,
  createFromSerialized,
  serializeFileDef,
} from '../../helpers/base-realm';

import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

let loader: Loader;

module(
  'Integration | spike CS-11568 | FileDef nested polymorphic field',
  function (hooks) {
    setupRenderingTest(hooks);
    setupBaseRealm(hooks);
    setupLocalIndexing(hooks);
    setupMockMatrix(hooks);

    hooks.beforeEach(function () {
      loader = getService('loader-service').loader;
    });

    // A command-like nested field that the polymorphic subclass holds many of.
    function defineCards() {
      class CommandField extends FieldDef {
        @field commandName = contains(StringField);
      }

      // Base polymorphic field that the FileDef's `frontmatter` slot is typed as.
      class FrontmatterField extends FieldDef {
        @field kind = contains(StringField);
      }

      // Concrete subclass chosen from YAML `kind: skill`. Holds a containsMany.
      class SkillField extends FrontmatterField {
        @field name = contains(StringField);
        @field commands = containsMany(CommandField);
      }

      // The FileDef subclass under test. `frontmatter` is polymorphic: declared
      // as FrontmatterField, runtime value is a SkillField.
      class MarkdownSpikeDef extends FileDef {
        @field frontmatter = contains(FrontmatterField);
      }

      return { CommandField, FrontmatterField, SkillField, MarkdownSpikeDef };
    }

    test('READ HALF: createFromSerialized rehydrates the polymorphic subclass + nested commands from meta.fields', async function (assert) {
      let { SkillField, MarkdownSpikeDef } = defineCards();
      let cards = defineCards();
      loader.shimModule(`${testRealmURL}spike-cards`, {
        CommandField: cards.CommandField,
        FrontmatterField: cards.FrontmatterField,
        SkillField: cards.SkillField,
        MarkdownSpikeDef: cards.MarkdownSpikeDef,
      });
      // use the shimmed classes so codeRefs resolve
      SkillField = cards.SkillField;
      MarkdownSpikeDef = cards.MarkdownSpikeDef;

      // This is the document shape the index WOULD need to write for the
      // round-trip to work — note the per-field `meta.fields.frontmatter.adoptsFrom`
      // pointing at the SkillField subclass.
      let doc: LooseSingleCardDocument = {
        data: {
          id: `${testRealmURL}skills/my-skill.md`,
          type: 'file-meta' as any,
          attributes: {
            sourceUrl: `${testRealmURL}skills/my-skill.md`,
            url: `${testRealmURL}skills/my-skill.md`,
            name: 'my-skill.md',
            contentType: 'text/markdown',
            frontmatter: {
              kind: 'skill',
              name: 'My Skill',
              commands: [
                { commandName: 'do-thing' },
                { commandName: 'do-other-thing' },
              ],
            },
          },
          meta: {
            adoptsFrom: {
              module: testRRI('spike-cards'),
              name: 'MarkdownSpikeDef',
            },
            fields: {
              frontmatter: {
                adoptsFrom: {
                  module: testRRI('spike-cards'),
                  name: 'SkillField',
                },
              },
            },
          },
        },
      };

      let instance = (await createFromSerialized<typeof MarkdownSpikeDef>(
        doc.data as any,
        doc,
        undefined,
      )) as InstanceType<typeof MarkdownSpikeDef>;

      assert.strictEqual(
        instance.name,
        'my-skill.md',
        'flat FileDef field survives',
      );
      assert.true(
        instance.frontmatter instanceof SkillField,
        'polymorphic field rehydrated as the SkillField SUBCLASS (not base FrontmatterField)',
      );
      assert.strictEqual(
        (instance.frontmatter as InstanceType<typeof SkillField>).name,
        'My Skill',
        'subclass-only field survives',
      );
      assert.strictEqual(
        (instance.frontmatter as InstanceType<typeof SkillField>).commands
          .length,
        2,
        'nested containsMany array survived round-trip',
      );
      assert.strictEqual(
        (instance.frontmatter as InstanceType<typeof SkillField>).commands[0]
          .commandName,
        'do-thing',
        'nested command value survived round-trip',
      );
    });

    test('SERIALIZE HALF: serializeFileDef emits meta.fields.frontmatter.adoptsFrom for the subclass', async function (assert) {
      let cards = defineCards();
      loader.shimModule(`${testRealmURL}spike-cards`, {
        CommandField: cards.CommandField,
        FrontmatterField: cards.FrontmatterField,
        SkillField: cards.SkillField,
        MarkdownSpikeDef: cards.MarkdownSpikeDef,
      });
      let { SkillField, MarkdownSpikeDef, CommandField } = cards;

      let cmd = new CommandField({ commandName: 'do-thing' });
      let skill = new SkillField({
        name: 'My Skill',
        kind: 'skill',
        commands: [cmd],
      });
      let fileDef = new MarkdownSpikeDef({
        id: `${testRealmURL}skills/my-skill.md`,
        sourceUrl: `${testRealmURL}skills/my-skill.md`,
        url: `${testRealmURL}skills/my-skill.md`,
        name: 'my-skill.md',
        contentType: 'text/markdown',
        frontmatter: skill,
      });

      let doc = serializeFileDef(fileDef as any);
      let fieldMeta = (doc.data.meta as any)?.fields?.frontmatter;
      assert.ok(fieldMeta, 'serializeFileDef produced meta.fields.frontmatter');
      assert.deepEqual(
        fieldMeta?.adoptsFrom,
        { module: testRRI('spike-cards'), name: 'SkillField' },
        'meta.fields.frontmatter.adoptsFrom records the concrete SkillField subclass',
      );
      // And the nested value is in attributes
      assert.strictEqual(
        (doc.data.attributes as any)?.frontmatter?.commands?.[0]?.commandName,
        'do-thing',
        'nested containsMany value present in serialized attributes',
      );
    });

    test('WRITE-PATH GAP: buildFileResource (the indexing path) drops meta.fields', async function (assert) {
      // Simulate what an extractAttributes() that returned a nested object value
      // would feed the indexer: a flat searchDoc with a nested `frontmatter`.
      let searchDoc = {
        sourceUrl: `${testRealmURL}skills/my-skill.md`,
        url: `${testRealmURL}skills/my-skill.md`,
        name: 'my-skill.md',
        contentType: 'text/markdown',
        frontmatter: {
          kind: 'skill',
          name: 'My Skill',
          commands: [{ commandName: 'do-thing' }],
        },
      };

      let resource = buildFileResource(
        `${testRealmURL}skills/my-skill.md`,
        searchDoc,
        { module: testRRI('spike-cards'), name: 'MarkdownSpikeDef' },
      );

      assert.deepEqual(
        resource.meta.adoptsFrom,
        { module: testRRI('spike-cards'), name: 'MarkdownSpikeDef' },
        'top-level adoptsFrom (the FileDef class) is recorded',
      );
      assert.strictEqual(
        (resource.meta as any).fields,
        undefined,
        'GAP CONFIRMED: buildFileResource emits NO meta.fields, so the per-field ' +
          'subclass marker the read path needs is never written by the indexer',
      );
      // The nested data itself does survive as a loose attribute...
      assert.strictEqual(
        (resource.attributes as any)?.frontmatter?.commands?.[0]?.commandName,
        'do-thing',
        'nested data survives in attributes (but with no type marker)',
      );
    });

    test('CONTINGENCY (low-risk half): flat kind written to searchDoc is filterable shape', async function (assert) {
      // The CS-11545 low-risk half only needs flat primitives in search_doc.
      // buildFileResource preserves flat top-level keys verbatim, which is what
      // searchFiles({ filter: { eq: { kind: 'skill' } } }) queries against.
      let searchDoc = {
        sourceUrl: `${testRealmURL}skills/my-skill.md`,
        url: `${testRealmURL}skills/my-skill.md`,
        name: 'my-skill.md',
        contentType: 'text/markdown',
        kind: 'skill',
        title: 'My Skill',
      };
      let resource = buildFileResource(
        `${testRealmURL}skills/my-skill.md`,
        searchDoc,
        { module: testRRI('spike-cards'), name: 'MarkdownSpikeDef' },
      );
      assert.strictEqual(
        (resource.attributes as any)?.kind,
        'skill',
        'flat kind preserved verbatim in resource.attributes (and thus in search_doc)',
      );
      assert.true(baseRealm.url.length > 0, 'sanity: base realm available');
    });
  },
);
