import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import type { RenderingTestContext } from '@ember/test-helpers';
import { click, render, settled } from '@ember/test-helpers';

import { tracked } from '@glimmer/tracking';

import { getService } from '@universal-ember/test-support';

import { module, test } from 'qunit';

import type { CodeRef, Loader } from '@cardstack/runtime-common';
import {
  CardContextName,
  PermissionsContextName,
  chooseCard,
  chooseFile,
  getField,
  identifyCard,
  rri,
  type LooseCardResource,
  type LooseSingleCardDocument,
} from '@cardstack/runtime-common';

import { projectHostBoxelSemantics } from '@cardstack/host/lib/boxel-projection';
import ElementTracker from '@cardstack/host/resources/element-tracker';

import {
  testRealmURL,
  testRRI,
  saveCard,
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  provideConsumeContext,
} from '../../helpers';
import {
  cardAPI,
  CardDef,
  CardInfoField,
  Component,
  FieldDef,
  StringField,
  NumberField,
  contains,
  containsMany,
  createFromSerialized,
  field,
  getFields,
  getFieldDescription,
  linksTo,
  serializeCard,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderCard, renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { CardDef as CardDefType, Format } from '@cardstack/base/card-api';
import type { ComponentLike } from '@glint/template';

let loader: Loader;

// Some component arguments are typed as always-present, so a template-side
// `{{if @set ...}}` trips TS2774; a plain helper keeps the presence probe
// glint-clean for every argument uniformly.
function present(value: unknown): string {
  return value ? 'present' : 'absent';
}

// CodeRef is a union whose exotic members have no `module`; the fixtures here
// only ever produce resolved `{module, name}` refs.
function moduleOf(ref: CodeRef | undefined): string | undefined {
  return ref && 'module' in ref ? (ref.module as string) : undefined;
}

module('Integration | rp-semantics', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);

  let mockMatrixUtils = setupMockMatrix(hooks);

  setupCardLogs(
    hooks,
    async () => await loader.import('@cardstack/base/card-api'),
  );

  // "getComponent(card, field?, opts?) ... is memoized per (model,
  // componentCodeRef) so reactive re-renders never remount the tree" and
  // "Component identity is stable per Box: the same box yields the same
  // component instance."
  test('RP-1.1, RP-1.4: getComponent is memoized per (model, componentCodeRef) and field component identity is stable per box', async function (assert) {
    class Gizmo extends CardDef {
      static displayName = 'Gizmo';
      @field title = contains(StringField);
      @field badge = contains(StringField);
    }
    loader.shimModule(`${testRealmURL}rp11-cards`, { Gizmo });
    let card = new Gizmo({ title: 'Widget', badge: 'gold' });

    let first = cardAPI.getComponent(card);
    let second = cardAPI.getComponent(card);
    assert.strictEqual(
      first,
      second,
      'repeated getComponent calls for the same model return the same component (no remount on re-render)',
    );

    let gizmoRef = identifyCard(Gizmo) as CodeRef;
    let pinnedFirst = cardAPI.getComponent(card, undefined, {
      componentCodeRef: gizmoRef,
    });
    let pinnedSecond = cardAPI.getComponent(card, undefined, {
      componentCodeRef: gizmoRef,
    });
    assert.strictEqual(
      pinnedFirst,
      pinnedSecond,
      'the memo key includes the componentCodeRef, so a pinned lookup is stable too',
    );
    assert.notStrictEqual(
      pinnedFirst,
      first,
      'a different componentCodeRef is a different cache entry',
    );

    let other = new Gizmo({ title: 'Other' });
    assert.notStrictEqual(
      cardAPI.getComponent(other),
      first,
      'a different model yields a different component',
    );

    let fieldsOfCard = first as unknown as Record<string, unknown>;
    assert.strictEqual(
      fieldsOfCard.badge,
      fieldsOfCard.badge,
      'the same box yields the same field component instance across repeated property access',
    );
  });

  // "The returned value is both invokable (<Thing/>) and indexable
  // (<Thing.someField/>): a proxy whose properties are the declared fields'
  // components, with ownKeys exposing declared field names (so
  // {{#each-in @fields}} works)."
  test('RP-1.2: the component is invokable and indexable, and ownKeys exposes declared field names', async function (assert) {
    class Chip extends FieldDef {
      static displayName = 'Chip';
      @field label = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-chip-label><@fields.label /></span>
        </template>
      };
    }
    class Indexable extends CardDef {
      static displayName = 'Indexable';
      @field title = contains(StringField);
      @field chip = contains(Chip);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-indexable-isolated>
            <@fields.title />
            {{#each-in @fields as |fieldName|}}
              <span data-test-iterated-field={{fieldName}}></span>
            {{/each-in}}
          </div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}rp12-cards`, { Chip, Indexable });
    let card = new Indexable({
      title: 'Indexed',
      chip: new Chip({ label: 'inner' }),
    });

    let component = cardAPI.getComponent(card);
    let ownKeys = Reflect.ownKeys(component as unknown as object);
    assert.true(
      ownKeys.includes('title'),
      'ownKeys exposes the declared title field',
    );
    assert.true(
      ownKeys.includes('chip'),
      'ownKeys exposes the declared chip field',
    );

    await renderComponent(component, 'isolated');
    assert
      .dom('[data-test-indexable-isolated]')
      .containsText('Indexed', 'the returned value is invokable as <Thing/>');
    assert
      .dom('[data-test-iterated-field="chip"]')
      .exists('each-in over @fields iterates the declared field names');

    let ChipSlot = (component as unknown as Record<string, ComponentLike>).chip;
    await renderComponent(ChipSlot);
    assert
      .dom('[data-test-chip-label]')
      .hasText(
        'inner',
        'a property of the proxy is the declared field component, invokable as <Thing.someField/>',
      );
  });

  // "opts.componentCodeRef pins rendering to an ancestor class's format
  // component ... No match falls back to the instance's own class."
  test("RP-1.3: componentCodeRef pins rendering to an ancestor's format component, and no match falls back to the instance's own class", async function (assert) {
    class ParentCard extends CardDef {
      static displayName = 'ParentCard';
      @field title = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-parent-embedded><@fields.title /></span>
        </template>
      };
    }
    class ChildCard extends ParentCard {
      static displayName = 'ChildCard';
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-child-embedded><@fields.title /></span>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}rp13-cards`, { ParentCard, ChildCard });
    let child = new ChildCard({ title: 'Heir' });
    let parentRef = identifyCard(ParentCard) as CodeRef;

    await renderComponent(
      cardAPI.getComponent(child, undefined, { componentCodeRef: parentRef }),
      'embedded',
    );
    assert
      .dom('[data-test-parent-embedded]')
      .hasText('Heir', "the ancestor's embedded component renders the child");
    assert
      .dom('[data-test-child-embedded]')
      .doesNotExist("the child's own template is not used when pinned");

    let missRef = {
      module: moduleOf(parentRef),
      name: 'NoSuchExport',
    } as CodeRef;
    await renderComponent(
      cardAPI.getComponent(child, undefined, { componentCodeRef: missRef }),
      'embedded',
    );
    assert
      .dom('[data-test-child-embedded]')
      .hasText('Heir', "no ancestor match falls back to the instance's class");
  });

  // "A def declares a format as a static class field ... inheritance is
  // plain static inheritance" plus the Base defaults, and RP-2.2's per-kind
  // slot claims at the class level (FieldDef has no isolated and no head).
  test('RP-2.2, RP-2.3: format slots are inherited statics with the documented Base defaults', async function (assert) {
    assert.ok(CardDef.isolated, 'CardDef declares a default isolated slot');
    assert.strictEqual(
      CardDef.isolated,
      CardDef.edit,
      'the CardDef defaults share one template reference (isolated === edit === DefaultCardDefTemplate)',
    );
    class PlainCard extends CardDef {}
    assert.strictEqual(
      PlainCard.isolated,
      CardDef.isolated,
      'an undeclared slot inherits by plain static inheritance',
    );
    class DeclaredCard extends CardDef {
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-declared-isolated></div>
        </template>
      };
    }
    assert.notStrictEqual(
      DeclaredCard.isolated,
      CardDef.isolated,
      'a declared static overrides the inherited slot',
    );
    class DeclaredSubclass extends DeclaredCard {}
    assert.strictEqual(
      DeclaredSubclass.isolated,
      DeclaredCard.isolated,
      "a subclass inherits its parent's declared slot",
    );

    assert.strictEqual(
      FieldDef.embedded,
      FieldDef.fitted,
      'FieldDef defaults embedded and fitted to the same MissingTemplate reference',
    );
    assert.ok(FieldDef.edit, 'FieldDef defaults edit to FieldDefEditTemplate');
    assert.notStrictEqual(
      FieldDef.edit,
      FieldDef.embedded,
      'the FieldDef edit default is not the missing-template default',
    );
    let fieldDefSlots = FieldDef as unknown as Record<string, unknown>;
    assert.strictEqual(
      fieldDefSlots.isolated,
      undefined,
      'FieldDef declares no isolated slot',
    );
    assert.strictEqual(
      fieldDefSlots.head,
      undefined,
      'FieldDef declares no head slot',
    );

    // A FieldDef that declares no embedded slot renders the inherited
    // MissingTemplate.
    class BareField extends FieldDef {
      static displayName = 'Bare';
      @field value = contains(StringField);
    }
    class BareHolder extends CardDef {
      static displayName = 'BareHolder';
      @field bare = contains(BareField);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.bare /></template>
      };
    }
    loader.shimModule(`${testRealmURL}rp23-cards`, { BareField, BareHolder });
    await renderCard(loader, new BareHolder(), 'isolated');
    assert
      .dom('[data-test-missing-template-text="embedded"]')
      .exists('an undeclared FieldDef embedded slot renders MissingTemplate');
  });

  // "A computed field never renders edit; it is rewritten to embedded at
  // format resolution."
  test('RP-2.5: a computed field never renders edit; it is rewritten to embedded', async function (assert) {
    class Auditless extends CardDef {
      static displayName = 'Auditless';
      @field name = contains(StringField);
      @field summary = contains(StringField, {
        computeVia: function (this: Auditless) {
          return `${this.name} summarized`;
        },
      });
      static edit = class Edit extends Component<typeof this> {
        <template>
          <span data-test-editable-slot><@fields.name /></span>
          <span data-test-computed-slot><@fields.summary /></span>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}rp25-cards`, { Auditless });

    await renderCard(loader, new Auditless({ name: 'Widget' }), 'edit');
    assert
      .dom('[data-test-editable-slot] input')
      .exists('a stored field renders its edit input inside the edit format');
    assert
      .dom('[data-test-computed-slot] input')
      .doesNotExist('the computed field is never given an edit component');
    assert
      .dom('[data-test-computed-slot]')
      .containsText(
        'Widget summarized',
        'the computed field renders its embedded presentation instead',
      );
  });

  // "In edit, a linked CardDef/FileDef target renders fitted (a linked card
  // is never edited inline)."
  test('RP-2.7: in edit, a linked CardDef target renders fitted, never an inline editor', async function (assert) {
    class PalCard extends CardDef {
      static displayName = 'Pal';
      @field nickname = contains(StringField);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <span data-test-pal-fitted><@fields.nickname /></span>
        </template>
      };
    }
    class PalOwner extends CardDef {
      static displayName = 'PalOwner';
      @field pal = linksTo(PalCard);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <div data-test-pal-slot><@fields.pal /></div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}rp27-cards`, { PalCard, PalOwner });
    let pal = new PalCard({ nickname: 'Rex' });
    await saveCard(pal, `${testRealmURL}Pal/rex`, loader);
    let owner = new PalOwner({ pal });

    await renderCard(loader, owner, 'edit');
    assert
      .dom('[data-test-pal-slot] [data-test-links-to-editor="pal"]')
      .exists('the linksTo field renders its editor chrome in edit');
    assert
      .dom('[data-test-pal-slot] [data-test-card-format="fitted"]')
      .exists('the linked CardDef target itself renders fitted');
    assert
      .dom('[data-test-pal-fitted]')
      .hasText('Rex', "the target's fitted template renders, not its editor");
  });

  // "When a class's edit slot is the same reference as its isolated slot,
  // the same component instance serves both formats so toggling edit does
  // not remount."
  test('RP-2.8: coalesced edit/view slots keep the same component mounted when toggling formats', async function (assert) {
    class FormatState {
      @tracked format: Format = 'isolated';
    }

    class Coalesced extends CardDef {
      static displayName = 'Coalesced';
      @field name = contains(StringField);
    }
    loader.shimModule(`${testRealmURL}rp28-cards`, { Coalesced });
    let card = new Coalesced({ name: 'Toggle' });
    let state = new FormatState();
    let Mounted = cardAPI.getComponent(card);
    await render(<template><Mounted @format={{state.format}} /></template>);

    let before = document.querySelector('.default-card-template');
    assert.ok(before, 'the shared default template mounted');
    assert.true(
      before?.classList.contains('isolated'),
      'it renders the isolated format first',
    );

    state.format = 'edit';
    await settled();
    let after = document.querySelector('.default-card-template');
    assert.strictEqual(
      after,
      before,
      'toggling isolated to edit keeps the exact same DOM subtree mounted (coalesced slots, no remount)',
    );
    assert.true(
      before?.classList.contains('edit'),
      'the same mounted component now branches on the edit format',
    );

    // Contrast: distinct isolated/edit slot references legitimately remount.
    class Split extends CardDef {
      static displayName = 'Split';
      @field name = contains(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-split-isolated></div>
        </template>
      };
      static edit = class Edit extends Component<typeof this> {
        <template>
          <div data-test-split-edit></div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}rp28-split-cards`, { Split });
    let splitCard = new Split({ name: 'Split' });
    let splitState = new FormatState();
    let SplitMounted = cardAPI.getComponent(splitCard);
    await render(
      <template><SplitMounted @format={{splitState.format}} /></template>,
    );
    let splitBefore = document.querySelector('[data-test-split-isolated]');
    assert.ok(splitBefore, 'the distinct isolated slot mounted');
    splitState.format = 'edit';
    await settled();
    assert
      .dom('[data-test-split-edit]')
      .exists('a distinct edit slot mounts its own component');
    assert.false(
      splitBefore?.isConnected,
      'without coalescing the previous format component is unmounted',
    );
  });

  // "The authored component argument contract (what every format component
  // receives) is: @cardOrField, @model, @fields, @format, @set, @fieldName,
  // @context, @configuration, @createCard, @viewCard, @saveCard, @editCard,
  // @canEdit, @typeConstraint." The [GAP] clause applies: SignatureFor omits
  // cardOrField/typeConstraint from the published type, so this fixture
  // asserts the published (typed) argument surface; the CRUD members are
  // legitimately undefined here because no provider exists (RP-10.3).
  test('RP-3.1: authored format components receive the documented component arguments', async function (assert) {
    class ArgBadge extends FieldDef {
      static displayName = 'ArgBadge';
      @field label = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span
            data-test-badge-fieldname={{@fieldName}}
            data-test-badge-model={{present @model}}
          ></span>
        </template>
      };
    }
    class ArgCard extends CardDef {
      static displayName = 'ArgCard';
      @field title = contains(StringField);
      @field badge = contains(ArgBadge);
      // The published SignatureFor type carries no `format` member (part of
      // the RP-3.1 [GAP] divergence between the runtime arguments and the
      // published type), so this typed fixture cannot stamp @format; the
      // runtime delivery of @format is asserted by the format-resolution
      // tests in this suite instead.
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div
            data-test-args
            data-arg-model={{present @model}}
            data-arg-fields={{present @fields}}
            data-arg-set={{present @set}}
            data-arg-context={{present @context}}
            data-arg-field-name={{present @fieldName}}
            data-arg-create-card={{present @createCard}}
            data-arg-view-card={{present @viewCard}}
            data-arg-edit-card={{present @editCard}}
            data-arg-save-card={{present @saveCard}}
            data-arg-can-edit={{if @canEdit 'true' 'falsy'}}
          ><@fields.badge /></div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}rp31-cards`, { ArgBadge, ArgCard });
    let card = new ArgCard({ title: 'Args', badge: new ArgBadge() });

    await renderCard(loader, card, 'isolated');
    assert.dom('[data-test-args]').hasAttribute('data-arg-model', 'present');
    assert.dom('[data-test-args]').hasAttribute('data-arg-fields', 'present');
    assert.dom('[data-test-args]').hasAttribute('data-arg-set', 'present');
    assert
      .dom('[data-test-args]')
      .hasAttribute(
        'data-arg-context',
        'present',
        '@context is always delivered (defaulted when no provider exists)',
      );
    assert
      .dom('[data-test-args]')
      .hasAttribute(
        'data-arg-field-name',
        'absent',
        'the root card render has no owning field name',
      );
    for (let crud of ['create-card', 'view-card', 'edit-card', 'save-card']) {
      assert
        .dom('[data-test-args]')
        .hasAttribute(
          `data-arg-${crud}`,
          'absent',
          `@${crud} is undefined without a CRUD provider`,
        );
    }
    assert
      .dom('[data-test-args]')
      .hasAttribute(
        'data-arg-can-edit',
        'falsy',
        '@canEdit is falsy without a permissions provider',
      );
    assert
      .dom('[data-test-badge-fieldname]')
      .hasAttribute(
        'data-test-badge-fieldname',
        'badge',
        'a nested field component receives its own @fieldName',
      );
    assert
      .dom('[data-test-badge-fieldname]')
      .hasAttribute('data-test-badge-model', 'present');
  });

  // "@model is the live instance for cards/compound fields (getters
  // reachable) and the raw value for primitive fields. @set writes through
  // the Box chain to the real model descriptor. @fieldName is the box name
  // (numeric string for plural children)."
  test('RP-3.2: @model is raw for primitives and live for cards, @set writes through, and plural children get numeric box names', async function (assert) {
    class InlineString extends StringField {
      static displayName = 'InlineString';
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-raw-model>{{@model}}</span>
          <span data-test-prim-fieldname={{@fieldName}}></span>
          <button
            type='button'
            data-test-write-through
            {{on 'click' (fn @set 'written-through-set')}}
          >set</button>
        </template>
      };
    }
    class Notebook extends CardDef {
      static displayName = 'Notebook';
      @field remark = contains(InlineString);
      @field remarks = containsMany(InlineString);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-singular><@fields.remark /></div>
          <div data-test-plural><@fields.remarks /></div>
          <span data-test-model-through-card>{{@model.remark}}</span>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}rp32-cards`, { InlineString, Notebook });
    let card = new Notebook({ remark: 'raw-value', remarks: ['a', 'b'] });

    await renderCard(loader, card, 'isolated');
    assert
      .dom('[data-test-singular] [data-test-raw-model]')
      .hasText(
        'raw-value',
        'a primitive field component receives the raw value as @model',
      );
    assert
      .dom('[data-test-singular] [data-test-prim-fieldname]')
      .hasAttribute('data-test-prim-fieldname', 'remark');
    assert
      .dom('[data-test-model-through-card]')
      .hasText('raw-value', '@model of the card is the live instance');

    let pluralNames = [
      ...document.querySelectorAll(
        '[data-test-plural] [data-test-prim-fieldname]',
      ),
    ].map((element) => element.getAttribute('data-test-prim-fieldname'));
    assert.deepEqual(
      pluralNames,
      ['0', '1'],
      'plural children receive numeric-string box names as @fieldName',
    );

    await click('[data-test-singular] [data-test-write-through]');
    assert.strictEqual(
      card.remark,
      'written-through-set',
      '@set writes through the Box chain to the real model descriptor',
    );
    assert
      .dom('[data-test-model-through-card]')
      .hasText(
        'written-through-set',
        'the write is observable through the live @model',
      );
  });

  // "Plural fields: @fields of a plural field is array-like (iterable,
  // length, index). Plural boxes key children by value identity unless the
  // element class declares static [useIndexBasedKey] (all Base primitives
  // do)."
  test('RP-3.4: @fields of a plural field is array-like, and Base primitives declare useIndexBasedKey', async function (assert) {
    class TagList extends CardDef {
      static displayName = 'TagList';
      @field tags = containsMany(StringField);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <span data-test-tag-count>{{@fields.tags.length}}</span>
          <ul>
            {{#each @fields.tags as |Tag|}}
              <li data-test-tag-item><Tag /></li>
            {{/each}}
          </ul>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}rp34-cards`, { TagList });
    let card = new TagList({ tags: ['gala', 'premiere'] });

    await renderCard(loader, card, 'isolated');
    assert.dom('[data-test-tag-count]').hasText('2', 'length is readable');
    assert
      .dom('[data-test-tag-item]')
      .exists({ count: 2 }, 'each iterates the plural field components');

    let TagsSlot = (
      cardAPI.getComponent(card) as unknown as Record<string, unknown>
    ).tags as {
      length: number;
      [index: number]: unknown;
      [Symbol.iterator](): Iterator<unknown>;
    };
    assert.strictEqual(TagsSlot.length, 2, 'index proxy exposes length');
    assert.ok(TagsSlot[0], 'index access yields a child component');
    assert.strictEqual(
      [...TagsSlot].length,
      2,
      'the plural fields value is iterable',
    );

    assert.true(
      cardAPI.useIndexBasedKey in StringField,
      'Base primitives declare static [useIndexBasedKey]',
    );
    class CompoundSample extends FieldDef {
      @field label = contains(StringField);
    }
    assert.false(
      cardAPI.useIndexBasedKey in CompoundSample,
      'compound fields default to value-identity keying',
    );
  });

  // "Polymorphism: the rendering class for a composite value is the runtime
  // value's constructor (a subclass stored in a contains(Base) field renders
  // with its own templates); per-instance overrides ... re-render on
  // assignment."
  test("RP-3.5: a composite value renders with the runtime value's constructor and re-renders on assignment", async function (assert) {
    class PolyBadge extends FieldDef {
      static displayName = 'PolyBadge';
      @field label = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-plain-badge><@fields.label /></span>
        </template>
      };
    }
    class FancyBadge extends PolyBadge {
      static displayName = 'FancyBadge';
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-fancy-badge><@fields.label /></span>
        </template>
      };
    }
    class BadgeHolder extends CardDef {
      static displayName = 'BadgeHolder';
      @field badge = contains(PolyBadge);
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.badge /></template>
      };
    }
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'poly-cards.gts': { PolyBadge, FancyBadge, BadgeHolder },
      },
    });

    // A serialized instance whose meta.fields declares the subclass: the
    // composite value materializes as (and renders with) that constructor.
    let resource: LooseCardResource = {
      id: `${testRealmURL}BadgeHolder/1`,
      attributes: { badge: { label: 'gala' } },
      meta: {
        adoptsFrom: { module: testRRI('poly-cards'), name: 'BadgeHolder' },
        fields: {
          badge: {
            adoptsFrom: { module: testRRI('poly-cards'), name: 'FancyBadge' },
          },
        },
      },
    };
    let deserialized = (await createFromSerialized(
      resource,
      { data: resource },
      new URL(`${testRealmURL}BadgeHolder/1`),
    )) as InstanceType<typeof BadgeHolder>;
    await renderCard(loader, deserialized, 'isolated');
    assert
      .dom('[data-test-fancy-badge]')
      .hasText('gala', "the subclass's own embedded template renders");
    assert
      .dom('[data-test-plain-badge]')
      .doesNotExist('the declared base class template is not used');

    // Assigning a different runtime value re-renders with the new
    // constructor's templates.
    let live = new BadgeHolder({ badge: new FancyBadge({ label: 'fancy' }) });
    await renderCard(loader, live, 'isolated');
    assert.dom('[data-test-fancy-badge]').hasText('fancy');
    live.badge = new PolyBadge({ label: 'plain' });
    await settled();
    assert
      .dom('[data-test-plain-badge]')
      .hasText('plain', 'assignment re-renders with the new value class');
    assert.dom('[data-test-fancy-badge]').doesNotExist();
  });

  // "Field descriptors are introspectable at render: getFields, getField,
  // getFieldDescription, and descriptor members name, card, fieldType,
  // computeVia, configuration, queryDefinition are author-reachable."
  test('RP-3.6: field descriptors are introspectable with the documented members', async function (assert) {
    class Crewmate extends CardDef {
      static displayName = 'Crewmate';
      @field name = contains(StringField);
    }
    class Roster extends CardDef {
      static displayName = 'Roster';
      @field captain = contains(StringField, {
        description: 'Named lead',
        configuration: { placeholder: 'who?' },
      });
      @field seats = containsMany(NumberField);
      @field flagship = linksTo(Crewmate);
      @field motto = contains(StringField, {
        computeVia: function (this: Roster) {
          return `${this.captain} leads`;
        },
      });
    }
    loader.shimModule(`${testRealmURL}rp36-cards`, { Crewmate, Roster });

    let descriptors = getFields(Roster, { includeComputeds: true });
    assert.strictEqual(descriptors.captain.name, 'captain');
    assert.strictEqual(
      descriptors.captain.card,
      StringField,
      'descriptor.card is the field class',
    );
    assert.strictEqual(descriptors.captain.fieldType, 'contains');
    assert.strictEqual(descriptors.seats.fieldType, 'containsMany');
    assert.strictEqual(descriptors.flagship.fieldType, 'linksTo');
    assert.deepEqual(
      descriptors.captain.configuration,
      { placeholder: 'who?' },
      'descriptor.configuration carries the per-usage configuration input',
    );
    assert.strictEqual(
      typeof descriptors.motto.computeVia,
      'function',
      'descriptor.computeVia is the compute function',
    );
    assert.strictEqual(
      descriptors.captain.computeVia,
      undefined,
      'stored fields have no computeVia',
    );
    assert.strictEqual(
      descriptors.captain.queryDefinition,
      undefined,
      'descriptor.queryDefinition is reachable (undefined for declared links)',
    );

    let instance = new Roster({ captain: 'Ada' });
    assert.strictEqual(
      getField(instance, 'flagship')?.fieldType,
      'linksTo',
      'getField resolves a descriptor from an instance',
    );
    assert.strictEqual(
      getFieldDescription(Roster, 'captain'),
      'Named lead',
      'getFieldDescription returns the authored description',
    );
  });

  // "Reactivity has one root: cardTracking (a per-instance TrackedWeakMap
  // read in every field getter, written by every setField)... Every tier
  // must reproduce invalidate-on-instance, not per-field tracking."
  test('RP-3.7: mutation invalidates per instance, re-evaluating even untouched computed fields', async function (assert) {
    let computeRuns = 0;
    class Meter extends CardDef {
      static displayName = 'Meter';
      @field label = contains(StringField);
      @field pulse = contains(StringField, {
        computeVia: function () {
          computeRuns++;
          return `run-${computeRuns}`;
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <span data-test-meter-label><@fields.label /></span>
          <span data-test-meter-pulse><@fields.pulse /></span>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}rp37-cards`, { Meter });
    let card = new Meter({ label: 'initial' });

    await renderCard(loader, card, 'isolated');
    assert.dom('[data-test-meter-label]').hasText('initial');
    let runsAfterFirstRender = computeRuns;
    assert.true(runsAfterFirstRender > 0, 'the compute ran for first paint');

    card.label = 'poked';
    await settled();
    assert
      .dom('[data-test-meter-label]')
      .hasText('poked', 'a direct field write re-renders the instance');
    assert.true(
      computeRuns > runsAfterFirstRender,
      'writing an unrelated field invalidated the whole instance: the untouched computed re-evaluated (instance-level, not per-field, tracking)',
    );
  });

  // "Computeds are strictly synchronous. A compute returning a Promise
  // stores the Promise as the value; there is no async-computed loading
  // state."
  test('RP-4.2: a compute returning a Promise stores the Promise as the value', function (assert) {
    class Eventually extends CardDef {
      static displayName = 'Eventually';
      @field eventual = contains(StringField, {
        computeVia: function () {
          return Promise.resolve('later') as unknown as string;
        },
      });
    }
    let card = new Eventually();
    let value: unknown = card.eventual;
    assert.true(
      value instanceof Promise,
      'the Promise itself is the field value — no async-computed resolution or loading state exists',
    );
  });

  // "A plain class getter is not a field: invisible to getFields, never
  // serialized ..., unreachable via <@fields.x/>, reachable only as
  // @model.x. A computeVia field is a real field."
  test('RP-4.4: a plain class getter is not a field, while a computeVia field is', function (assert) {
    // Deliberately no field named 'name' here: the fields proxy's ownKeys
    // trap (base field-component.gts) appends declared field names to the
    // component class's own keys, and a function class already owns a
    // built-in 'name' property — a field spelled 'name' makes the trap
    // return duplicate entries, which the proxy invariant rejects with a
    // TypeError. That is a main-behavior artifact of the legacy fields
    // proxy, not part of RP-4.4's sentence, so this fixture stays off the
    // colliding spelling ('length' and 'prototype' would collide the same
    // way).
    class Speaker extends CardDef {
      static displayName = 'Speaker';
      @field alias = contains(StringField);
      @field loud = contains(StringField, {
        computeVia: function (this: Speaker) {
          return (this.alias ?? '').toUpperCase();
        },
      });
      get quiet() {
        return `(${this.alias})`;
      }
    }
    loader.shimModule(`${testRealmURL}rp44-cards`, { Speaker });
    let card = new Speaker({ alias: 'Ada' });

    let descriptors = getFields(card, { includeComputeds: true }) as Record<
      string,
      unknown
    >;
    assert.ok(descriptors.loud, 'the computeVia field is a real field');
    assert.strictEqual(
      descriptors.quiet,
      undefined,
      'the plain getter is invisible to getFields',
    );

    let serialized = serializeCard(card);
    let attributes = serialized.data.attributes ?? {};
    assert.false('quiet' in attributes, 'the plain getter is never serialized');

    assert.strictEqual(
      card.quiet,
      '(Ada)',
      'the getter is reachable as @model.quiet',
    );
    assert.strictEqual(card.loud, 'ADA', 'the computed field is readable');

    let ownKeys = Reflect.ownKeys(
      cardAPI.getComponent(card) as unknown as object,
    );
    assert.true(
      ownKeys.includes('loud'),
      'the computed field is reachable through the fields proxy',
    );
    assert.false(
      ownKeys.includes('quiet'),
      'the getter is unreachable via <@fields.x/>',
    );
  });

  // "Configuration inputs are the FieldDef's static configuration and the
  // per-usage options.configuration; each may be an object or a function"
  // plus RP-5.2's full merge law: per-usage wins, one-level spread-merge for
  // nested objects, arrays and null replace, undefined never overwrites,
  // memoized per (instance, fieldName), invalidated by instance mutation.
  test('RP-5.1, RP-5.2: configuration resolution merges FieldDef-static and per-usage inputs under the documented merge law', function (assert) {
    class ConfField extends FieldDef {
      static displayName = 'ConfField';
      static configuration = function (this: ConfHolder) {
        return {
          source: 'static',
          owner: this.headline,
          nested: { x: 1, y: 2 },
          arr: [1, 2],
          keep: 'static-kept',
          n: 'replace-me',
        };
      };
      @field value = contains(StringField);
    }
    class ConfHolder extends CardDef {
      static displayName = 'ConfHolder';
      @field headline = contains(StringField);
      @field slot = contains(ConfField, {
        configuration: {
          source: 'usage',
          nested: { y: 3, z: 4 },
          arr: [9],
          n: null,
          keep: undefined,
        },
      });
    }
    let card = new ConfHolder({ headline: 'Root' });
    let slotField = getField(card, 'slot')!;

    let resolved = cardAPI.resolveFieldConfiguration(slotField, card);
    assert.deepEqual(
      resolved,
      {
        source: 'usage',
        owner: 'Root',
        nested: { x: 1, y: 3, z: 4 },
        arr: [9],
        keep: 'static-kept',
        n: null,
      },
      'per-usage wins, nested objects spread-merge one level, arrays and null replace, undefined never overwrites, and the static function saw the owning root instance',
    );
    assert.strictEqual(
      cardAPI.resolveFieldConfiguration(slotField, card),
      resolved,
      'resolution is memoized per (instance, fieldName)',
    );

    card.headline = 'Rebased';
    let reResolved = cardAPI.resolveFieldConfiguration(slotField, card);
    assert.notStrictEqual(
      reResolved,
      resolved,
      'instance mutation invalidates the memo',
    );
    assert.strictEqual(
      reResolved?.owner,
      'Rebased',
      'the re-resolved configuration reflects the mutated root instance',
    );
  });

  // "Each may be ... a function called with the owning root instance as
  // this" and "The resolved value is delivered as @configuration. The owning
  // instance itself is deliberately not exposed to nested templates" — the
  // nested template's only channels here are @configuration and its own
  // field @model.
  test('RP-5.1, RP-5.3: the render pipeline calls configuration functions with the owning root instance and delivers the result as @configuration', async function (assert) {
    class ConfBadge extends FieldDef {
      static displayName = 'ConfBadge';
      static configuration = function (this: ConfCard) {
        return { owner: this.headline, source: 'static' };
      };
      @field value = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-config-owner>{{@configuration.owner}}</span>
          <span data-test-config-source>{{@configuration.source}}</span>
        </template>
      };
    }
    class ConfCard extends CardDef {
      static displayName = 'ConfCard';
      @field headline = contains(StringField);
      @field slot = contains(ConfBadge, {
        configuration: { source: 'usage' },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template><@fields.slot /></template>
      };
    }
    loader.shimModule(`${testRealmURL}rp53-cards`, { ConfBadge, ConfCard });

    await renderCard(loader, new ConfCard({ headline: 'Root' }), 'isolated');
    assert
      .dom('[data-test-config-owner]')
      .hasText(
        'Root',
        'the static configuration function executed with the owning root instance as this',
      );
    assert
      .dom('[data-test-config-source]')
      .hasText(
        'usage',
        'the merged resolution (per-usage winning) is what @configuration delivers',
      );
  });

  // "Configuration functions execute with their semantic owner ...; the
  // resolved data crosses the boundary."
  test('RP-5.4: resolved configuration crosses the execution boundary as cloneable data, never as the function', function (assert) {
    class WireConfField extends FieldDef {
      static displayName = 'WireConfField';
      static configuration = function (this: WireConfCard) {
        return { owner: this.headline, depth: { a: 1 } };
      };
      @field value = contains(StringField);
    }
    class WireConfCard extends CardDef {
      static displayName = 'WireConfCard';
      @field headline = contains(StringField);
      @field slot = contains(WireConfField, {
        configuration: { extra: 'usage' },
      });
    }
    loader.shimModule(`${testRealmURL}rp54-cards`, {
      WireConfField,
      WireConfCard,
    });
    let card = new WireConfCard({ headline: 'Root' });

    let projection = projectHostBoxelSemantics(card, cardAPI);
    let slot = projection.fields.find(
      (candidate) => candidate.fieldName === 'slot',
    );
    assert.deepEqual(
      slot?.resolvedConfiguration,
      { owner: 'Root', depth: { a: 1 }, extra: 'usage' },
      'the Host materializes the function-form configuration over the canonical instance and the record carries the resolved data',
    );
    let wireValue = slot?.resolvedConfiguration ?? null;
    assert.deepEqual(
      structuredClone(wireValue),
      wireValue,
      'what crosses the boundary is cloneable data — no configuration function survives into the record',
    );
  });

  // "Permissions: {canRead, canWrite} live getters; sole consumer is the
  // @canEdit predicate."
  test('RP-10.4: the permissions context feeds @canEdit through live getters', async function (assert) {
    class PermitProbe extends CardDef {
      static displayName = 'PermitProbe';
      @field name = contains(StringField);
      static edit = class Edit extends Component<typeof this> {
        <template>
          <span data-test-can-edit>{{if @canEdit 'can-edit' 'read-only'}}</span>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}rp104-cards`, { PermitProbe });
    class PermissionsState {
      @tracked canWrite = true;
      get canRead() {
        return true;
      }
    }
    let permissions = new PermissionsState();
    provideConsumeContext(PermissionsContextName, permissions);

    await renderCard(loader, new PermitProbe({ name: 'Gated' }), 'edit');
    assert
      .dom('[data-test-can-edit]')
      .hasText('can-edit', 'canWrite: true delivers @canEdit');

    permissions.canWrite = false;
    await settled();
    assert
      .dom('[data-test-can-edit]')
      .hasText(
        'read-only',
        'the permissions members are live getters: revoking canWrite flips @canEdit without a remount',
      );
  });

  // "Default formats: absent provider ⇒ {cardDef:'isolated',
  // fieldDef:'embedded'}."
  test('RP-10.5: with no default-formats provider, a card renders isolated and a field renders embedded', async function (assert) {
    class Plain extends CardDef {
      static displayName = 'Plain';
      @field name = contains(StringField);
    }
    loader.shimModule(`${testRealmURL}rp105-cards`, { Plain });
    await renderComponent(cardAPI.getComponent(new Plain({ name: 'Bare' })));
    assert
      .dom('[data-test-field-component-card]')
      .hasAttribute(
        'data-test-card-format',
        'isolated',
        'an unprovided cardDef default resolves to isolated',
      );

    class ChipField extends FieldDef {
      static displayName = 'ChipField';
      @field label = contains(StringField);
      static embedded = class Embedded extends Component<typeof this> {
        <template>
          <span data-test-chip-embedded><@fields.label /></span>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}rp105-field-cards`, { ChipField });
    await renderComponent(
      cardAPI.getComponent(new ChipField({ label: 'chipped' })),
    );
    assert
      .dom('[data-test-compound-field-format="embedded"]')
      .exists('an unprovided fieldDef default resolves to embedded');
    assert.dom('[data-test-chip-embedded]').hasText('chipped');
  });

  // "Ambient globals that are part of the contract...:
  // globalThis.__card_api_shared_state (the shared identity/tracking
  // bucket...); _CARDSTACK_CARD_CHOOSER / _CARDSTACK_FILE_CHOOSER (throw
  // when unset; required for link editing)."
  test('RP-10.6: the chooser ambient hooks throw when unset and the shared card-api state bucket is provided', async function (assert) {
    let globalScope = globalThis as {
      _CARDSTACK_CARD_CHOOSER?: unknown;
      _CARDSTACK_FILE_CHOOSER?: unknown;
      __card_api_shared_state?: unknown;
    };
    assert.ok(
      globalScope.__card_api_shared_state,
      'importing card-api provides the shared identity/tracking bucket on globalThis',
    );

    let savedCardChooser = globalScope._CARDSTACK_CARD_CHOOSER;
    let savedFileChooser = globalScope._CARDSTACK_FILE_CHOOSER;
    delete globalScope._CARDSTACK_CARD_CHOOSER;
    delete globalScope._CARDSTACK_FILE_CHOOSER;
    try {
      await assert.rejects(
        chooseCard({}),
        /no cardstack card chooser/,
        'the card chooser hook throws when unset rather than degrading silently',
      );
      await assert.rejects(
        chooseFile(),
        /no cardstack file chooser/,
        'the file chooser hook throws when unset rather than degrading silently',
      );
    } finally {
      if (savedCardChooser !== undefined) {
        globalScope._CARDSTACK_CARD_CHOOSER = savedCardChooser;
      }
      if (savedFileChooser !== undefined) {
        globalScope._CARDSTACK_FILE_CHOOSER = savedFileChooser;
      }
    }
  });

  // "Author-declared, host-read statics: displayName, ..., headerColor,
  // prefersWideFormat, prefersFullSandbox (routing input)..." — asserted
  // through the Host projection that reads them.
  test('RP-11.1: presentation statics are read by the Host into the type description', function (assert) {
    class Branded extends CardDef {
      static displayName = 'Branded';
      static headerColor = '#ff8800';
      static prefersWideFormat = true;
      static prefersFullSandbox = true;
    }
    class Unbranded extends CardDef {
      static displayName = 'Unbranded';
    }
    loader.shimModule(`${testRealmURL}rp111-cards`, { Branded, Unbranded });

    let branded = projectHostBoxelSemantics(new Branded(), cardAPI).boxel;
    assert.deepEqual(
      branded.presentation,
      {
        displayName: 'Branded',
        headerColor: '#ff8800',
        prefersWideFormat: true,
      },
      'displayName, headerColor, and prefersWideFormat are host-read into the type presentation',
    );
    assert.true(
      branded.executionHints.prefersFullSandbox,
      'prefersFullSandbox is host-read as a routing input',
    );

    let unbranded = projectHostBoxelSemantics(new Unbranded(), cardAPI).boxel;
    assert.deepEqual(
      unbranded.presentation,
      {
        displayName: 'Unbranded',
        headerColor: null,
        prefersWideFormat: false,
      },
      'undeclared statics read as their documented defaults',
    );
    assert.false(unbranded.executionHints.prefersFullSandbox);
  });

  // "cardInfo is contains(CardInfoField) with fields name, summary,
  // cardThumbnail, cardThumbnailURL, theme, notes — no guide field on main.
  // The computed mirrors are cardTitle (falls back to Untitled
  // {displayName}), cardDescription, cardThumbnailURL, cardTheme."
  test('RP-11.2: the cardInfo field inventory and its computed mirrors match the spec', function (assert) {
    let descriptors = getFields(CardInfoField, { includeComputeds: true });
    assert.deepEqual(
      Object.keys(descriptors).sort(),
      [
        'cardThumbnail',
        'cardThumbnailURL',
        'name',
        'notes',
        'summary',
        'theme',
      ],
      'CardInfoField declares exactly the six documented fields',
    );
    assert.false('guide' in descriptors, 'there is no guide field on main');

    class Gizmo extends CardDef {
      static displayName = 'Gizmo';
    }
    let card = new Gizmo();
    assert.strictEqual(
      card.cardTitle,
      'Untitled Gizmo',
      'cardTitle falls back to Untitled {displayName}',
    );
    card.cardInfo.name = 'Named Gizmo';
    assert.strictEqual(
      card.cardTitle,
      'Named Gizmo',
      'cardTitle mirrors cardInfo.name',
    );
    card.cardInfo.summary = 'A summary';
    assert.strictEqual(
      card.cardDescription,
      'A summary',
      'cardDescription mirrors cardInfo.summary',
    );
    card.cardInfo.cardThumbnailURL = 'https://example.test/thumb.png';
    assert.strictEqual(
      card.cardThumbnailURL,
      'https://example.test/thumb.png',
      'cardThumbnailURL mirrors cardInfo.cardThumbnailURL',
    );
  });

  // "The host discovers card-internal DOM exclusively via the injected
  // cardComponentModifier applied to every rendered card container (with
  // card, format, fieldType, fieldName)."
  test('RP-11.5: the injected cardComponentModifier reports every rendered card container with card, format, fieldType, and fieldName', async function (assert) {
    class TrackedPal extends CardDef {
      static displayName = 'TrackedPal';
      @field nickname = contains(StringField);
      static fitted = class Fitted extends Component<typeof this> {
        <template>
          <span data-test-tracked-pal><@fields.nickname /></span>
        </template>
      };
    }
    class TrackedOwner extends CardDef {
      static displayName = 'TrackedOwner';
      @field pal = linksTo(TrackedPal);
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-owner-root><@fields.pal /></div>
        </template>
      };
    }
    loader.shimModule(`${testRealmURL}rp115-cards`, {
      TrackedPal,
      TrackedOwner,
    });
    let pal = new TrackedPal({ nickname: 'Rex' });
    let palId = `${testRealmURL}Pal/tracked-rex`;
    await saveCard(pal, palId, loader);
    let owner = new TrackedOwner({ pal });

    let tracker = new ElementTracker();
    provideConsumeContext(CardContextName, {
      cardComponentModifier: tracker.trackElement,
    });

    await renderCard(loader, owner, 'isolated');
    await settled();

    let ownerEntry = tracker.elements.find(
      (entry) => entry.meta.card === (owner as CardDefType),
    );
    assert.ok(ownerEntry, 'the root card container is reported to the host');
    assert.strictEqual(ownerEntry?.meta.format, 'isolated');
    assert.strictEqual(
      ownerEntry?.meta.fieldName,
      undefined,
      'the root render carries no owning field name',
    );

    let palEntry = tracker.elements.find(
      (entry) => entry.meta.card === (pal as CardDefType),
    );
    assert.ok(palEntry, 'the nested linked card container is reported too');
    assert.strictEqual(palEntry?.meta.format, 'fitted');
    assert.strictEqual(palEntry?.meta.fieldType, 'linksTo');
    assert.strictEqual(palEntry?.meta.fieldName, 'pal');
    assert.strictEqual(
      palEntry?.element.getAttribute('data-boxel-card-id'),
      palId,
      'the reported element is the card container carrying the emitted data-boxel-* attributes',
    );
  });

  // "createFromSerialized(resource, doc, relativeTo, opts) resolves
  // meta.adoptsFrom against the resource's own id when it has one, else the
  // supplied relativeTo."
  test("RP-8.1: adoptsFrom resolves against the resource's own id when present, else the supplied relativeTo", async function (assert) {
    class DeepPal extends CardDef {
      static displayName = 'DeepPal';
      @field nickname = contains(StringField);
    }
    class DeepOwner extends CardDef {
      static displayName = 'DeepOwner';
      @field pal = linksTo(DeepPal);
    }
    await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'deep/linkable.gts': { DeepPal },
        'entry.gts': { DeepOwner },
      },
    });

    // The side-loaded resource's module is spelled relative to ITS OWN id
    // (`${testRealmURL}deep/Pal/2` + '../linkable' →
    // `${testRealmURL}deep/linkable`). Resolving against the delivering
    // document's primary id or the caller's relativeTo (both under /Owner/)
    // would target a module that does not exist, so successful
    // materialization proves the resource's own id is the base.
    let palId = `${testRealmURL}deep/Pal/2`;
    let ownerResource: LooseCardResource = {
      id: `${testRealmURL}Owner/1`,
      attributes: {},
      relationships: {
        pal: {
          links: { self: palId },
          data: { type: 'card', id: palId },
        },
      },
      meta: {
        adoptsFrom: { module: testRRI('entry'), name: 'DeepOwner' },
      },
    };
    let doc = {
      data: ownerResource,
      included: [
        {
          type: 'card',
          id: palId,
          attributes: { nickname: 'Own-Id Resolved' },
          meta: { adoptsFrom: { module: '../linkable', name: 'DeepPal' } },
        },
      ],
    } as unknown as LooseSingleCardDocument;
    let owner = (await createFromSerialized(
      ownerResource,
      doc,
      new URL(`${testRealmURL}Owner/1`),
    )) as InstanceType<typeof DeepOwner>;
    let pal = owner.pal as InstanceType<typeof DeepPal> | undefined;
    assert.strictEqual(
      pal?.nickname,
      'Own-Id Resolved',
      'the side-loaded resource materialized',
    );
    assert.strictEqual(
      moduleOf(identifyCard(pal!.constructor as typeof CardDef)),
      testRRI('deep/linkable'),
      "the relative module resolved against the resource's own id",
    );

    // An id-less resource has no own base: the supplied relativeTo is the
    // resolution base for its relative module reference.
    let bare = {
      attributes: { nickname: 'Relative Resolved' },
      meta: { adoptsFrom: { module: '../linkable', name: 'DeepPal' } },
    } as unknown as LooseCardResource;
    let bareInstance = (await createFromSerialized(
      bare,
      { data: bare },
      rri(`${testRealmURL}deep/Anything/1`),
    )) as InstanceType<typeof DeepPal>;
    assert.strictEqual(bareInstance.nickname, 'Relative Resolved');
    assert.strictEqual(
      moduleOf(identifyCard(bareInstance.constructor as typeof CardDef)),
      testRRI('deep/linkable'),
      'an id-less resource resolves its module against the supplied relativeTo',
    );
  });
});
