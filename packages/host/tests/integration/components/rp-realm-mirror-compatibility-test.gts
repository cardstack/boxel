import 'ses';

import { waitFor, waitUntil } from '@ember/test-helpers';
import GlimmerComponent from '@glimmer/component';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import CardRenderer from '@cardstack/host/components/card-renderer';
import { classifyBoxelSource } from '@cardstack/host/lib/boxel-source-classifier';
import cmContext from '@cardstack/host/lib/codemirror-context';

import {
  setupCardLogs,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  testRealmURL,
  withCachedRealmSetup,
} from '../../helpers';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { renderComponent } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

import type { BaseDef } from '@cardstack/base/card-api';

// Authoritative compact mirror fixture, copied without simplification from:
//   sandbox-compatibility-corpus-20260803/nested-field-host.gts
// It exercises a CardDef -> contained FieldDef -> primitive FieldDef render
// graph and the trusted Base default edit surface with one small source file.
const nestedFieldHostSource = `
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import enumField from '@cardstack/base/enum';

const StatusField = enumField(StringField, {
  options: ['draft', 'ready'],
});

export class PostalAddress extends FieldDef {
  @field street = contains(StringField);
  @field city = contains(StringField);
  @field region = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <address class='address' data-corpus='nested-field'>
        <span class='pin'>⌖</span>
        <span>
          <strong>{{@model.street}}</strong><br />
          {{@model.city}}, {{@model.region}}
        </span>
      </address>
      <style scoped>
        .address { display: flex; gap: 0.9rem; padding: 1.1rem; color: #2b201b; background: #fff8ec; border: 1px solid #dfc9a8; border-radius: 0.75rem; font-style: normal; line-height: 1.5; }
        .pin { color: #b44d31; font-size: 1.5rem; }
      </style>
    </template>
  };
}

export class NestedFieldHost extends CardDef {
  static displayName = 'Nested Field Host';

  @field title = contains(StringField);
  @field status = contains(StatusField);
  @field address = contains(PostalAddress);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='venue' data-corpus='nested-field-host'>
        <p class='kicker'>FIELDDEF DELEGATION</p>
        <h1>{{@model.title}}</h1>
        <@fields.address />
      </article>
      <style scoped>
        .venue { max-width: 38rem; padding: 2rem; color: #2b201b; background: #f3e7d3; }
        .kicker { font: 700 0.72rem/1 ui-monospace, monospace; letter-spacing: 0.14em; }
        h1 { margin: 0.5rem 0 1.5rem; font: 700 2.8rem/1 ui-serif, serif; }
      </style>
    </template>
  };
}
`;

// Authoritative relationship mirror fixture, copied without simplification
// from sandbox-compatibility-corpus-20260803/linked-project.gts. It exercises
// both linksTo and linksToMany, including delegated relationship components
// selected by index through the trusted Base `get` helper.
const linkedProjectSource = `
import { get } from '@ember/helper';
import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
  linksToMany,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class Person extends CardDef {
  static displayName = 'Corpus Person';
  @field name = contains(StringField);
  @field specialty = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template><span class='person' data-corpus='linked-person'><strong>{{@model.name}}</strong><small>{{@model.specialty}}</small></span><style scoped>.person { display: grid; gap: 0.15rem; padding: 0.75rem; background: #eef3ff; border: 1px solid #beccec; border-radius: 0.6rem; } small { color: #52617f; }</style></template>
  };
}

export class LinkedProject extends CardDef {
  static displayName = 'Linked Project';
  @field title = contains(StringField);
  @field owner = linksTo(Person);
  @field reviewers = linksToMany(Person);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='project' data-corpus='linked-project'>
        <p class='kicker'>RELATIONSHIP DELEGATION</p><h1>{{@model.title}}</h1>
        <section><h2>Owner</h2><@fields.owner /></section>
        <section><h2>Reviewers</h2><div class='people'>{{#each @model.reviewers as |_person index|}}{{#let (get @fields.reviewers index) as |PersonField|}}<PersonField @format='embedded' />{{/let}}{{/each}}</div></section>
      </article>
      <style scoped>
        .project { max-width: 48rem; padding: 2rem; color: #17223a; background: #f7f9ff; }
        .kicker { color: #4668b2; font: 700 0.72rem/1 ui-monospace, monospace; letter-spacing: 0.12em; }
        h1 { margin: 0.5rem 0 2rem; font-size: 2.7rem; }
        h2 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em; }
        section { margin-top: 1.5rem; }
        .people { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: 0.65rem; }
      </style>
    </template>
  };
}
`;

// Compact real-world mirror covering primitive Base fields, function-form
// computeVia, presentation metadata, scoped CSS, and three authored formats.
const primitiveProfileSource = `
import {
  CardDef,
  Component,
  contains,
  field,
} from '@cardstack/base/card-api';
import BooleanField from '@cardstack/base/boolean';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

export class PrimitiveProfile extends CardDef {
  static displayName = 'Primitive Profile';
  static prefersWideFormat = true;

  @field name = contains(StringField);
  @field role = contains(StringField);
  @field weeklyHours = contains(NumberField);
  @field remote = contains(BooleanField);
  @field capacityLabel = contains(StringField, {
    computeVia: function (this: PrimitiveProfile) {
      let mode = this.remote ? 'remote' : 'studio';
      return \`\${this.weeklyHours ?? 0} hours · \${mode}\`;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='profile' data-corpus='primitive-profile'>
        <div class='initials'>AR</div>
        <div>
          <p class='kicker'>CREATIVE OPERATIONS</p>
          <h1>{{@model.name}}</h1>
          <p class='role'>{{@model.role}}</p>
          <p class='capacity'>{{@model.capacityLabel}}</p>
        </div>
      </article>
      <style scoped>
        .profile { display: grid; grid-template-columns: auto 1fr; gap: 1.5rem; align-items: center; min-height: 22rem; padding: 3rem; color: #14211c; background: linear-gradient(135deg, #d8f5e8, #f7f2e2); }
        .initials { display: grid; place-items: center; width: 8rem; aspect-ratio: 1; border: 1px solid #14211c; border-radius: 50%; font: 700 2.5rem/1 ui-serif, serif; }
        .kicker { color: #19704f; font: 700 0.75rem/1 ui-monospace, monospace; letter-spacing: 0.14em; }
        h1 { margin: 0.35rem 0; font-size: clamp(2.5rem, 7vw, 5.5rem); line-height: 0.95; letter-spacing: -0.06em; }
        .role { margin: 0; font-size: 1.3rem; }
        .capacity { display: inline-block; margin-top: 1.25rem; padding: 0.55rem 0.8rem; color: #fff; background: #14211c; border-radius: 999px; }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template><strong data-corpus='primitive-profile-embedded'>{{@model.name}} · {{@model.role}}</strong></template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template><span data-corpus='primitive-profile-fitted'>{{@model.name}}</span></template>
  };
}
`;

// Authoritative composition mirrors from the compatibility corpus. Together
// they exercise a trusted Base FieldDef, trusted Boxel UI and icon modules,
// and authored cards delegated in four formats from rich markdown. The image
// directive is covered by Base's file tests; this fixture keeps the execution
// graph self-contained so a failure identifies the rendering boundary.
const multiFormatSignalSource = `
import {
  CardDef,
  Component,
  contains,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { FittedCard } from '@cardstack/boxel-ui/components';
import RadioIcon from '@cardstack/boxel-icons/radio-tower';

export class MultiFormatSignal extends CardDef {
  static displayName = 'Multi-format Signal';
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field status = contains(StringField);
  @field channel = contains(StringField);
  @field description = contains(StringField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <main class='signal' data-corpus='multi-format-signal'>
        <section class='copy'>
          <div class='icon'><RadioIcon width='42' height='42' /></div>
          <p>STANDARD LIBRARY · FOUR AUTHORED FORMATS</p>
          <h1>{{@model.title}}</h1>
          <span>{{@model.description}}</span>
          <dl>
            <div><dt>Status</dt><dd>{{@model.status}}</dd></div>
            <div><dt>Channel</dt><dd>{{@model.channel}}</dd></div>
          </dl>
        </section>
        <aside>
          <p>FittedCard rendered inside isolated</p>
          <FittedCard @titleTag='h3'>
            <:eyebrow>{{@model.status}} signal</:eyebrow>
            <:title>{{@model.title}}</:title>
            <:subtitle>{{@model.description}}</:subtitle>
            <:meta>{{@model.channel}}</:meta>
            <:footer>Trusted standard-library component</:footer>
          </FittedCard>
        </aside>
      </main>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    <template><article data-corpus='multi-format-signal-embedded'><RadioIcon width='18' height='18' /><strong>{{@model.title}}</strong><span>{{@model.status}}</span></article></template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    <template>
      <FittedCard @titleTag='h3' data-corpus='multi-format-signal-fitted'>
        <:eyebrow>{{@model.status}} signal</:eyebrow>
        <:title>{{@model.title}}</:title>
        <:subtitle>{{@model.description}}</:subtitle>
        <:meta>{{@model.channel}}</:meta>
        <:footer>Multi-format compatibility</:footer>
      </FittedCard>
    </template>
  };

  static atom = class Atom extends Component<typeof this> {
    <template><span data-corpus='multi-format-signal-atom'><RadioIcon width='12' height='12' /> {{@model.status}}</span></template>
  };
}
`;

const markdownArticleSource = `
import {
  CardDef,
  Component,
  contains,
  field,
} from '@cardstack/base/card-api';
import RichMarkdownField from '@cardstack/base/rich-markdown';
import StringField from '@cardstack/base/string';

export class MarkdownArticle extends CardDef {
  static displayName = 'Rich Markdown Article';

  @field title = contains(StringField);
  @field dek = contains(StringField);
  @field body = contains(RichMarkdownField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article class='article' data-corpus='markdown-article'>
        <header><p>RICH MARKDOWN · LINKED EMBEDS · EDITOR</p><h1>{{@model.title}}</h1><h2>{{@model.dek}}</h2></header>
        <div class='body'><@fields.body @format='embedded' /></div>
      </article>
    </template>
  };
}
`;

// G-06: an ordinary Capsule parent owns the relationship and authored
// layout, while the independently loaded child module requires browser
// authority. The field portal must re-enter Host policy and mount the child
// in Sandbox; it must never inherit the parent's Capsule merely because it
// is nested in the parent's template.
const browserDependentChildSource = `
import { CardDef, Component, contains, field } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import { modifier } from 'ember-modifier';

const paint = modifier((element, [label]) => {
  element.textContent = label;
});

export class BrowserDependentChild extends CardDef {
  @field label = contains(StringField);
  static isolated = class Isolated extends Component<typeof this> {
    <template><div data-corpus='browser-dependent-child' {{paint @model.label}}></div></template>
  };
}
`;

const capsuleSandboxParentSource = `
import { CardDef, Component, contains, field, linksTo } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class CapsuleSandboxParent extends CardDef {
  @field title = contains(StringField);
  // The broad relationship is intentional. Importing the concrete child
  // module here would put its browser dependency in this module's static
  // import closure and correctly strengthen the parent itself to Sandbox.
  // A linksTo(CardDef) edge instead models the real independently-loaded
  // graph edge: the safe parent remains Capsule and Host policy routes the
  // concrete linked instance when the field portal renders it.
  @field child = linksTo(CardDef);
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article data-corpus='capsule-sandbox-parent'>
        <h1>{{@model.title}}</h1>
        <@fields.child @format='isolated' />
      </article>
    </template>
  };
}
`;

const richMarkdownContent = `## Visible proof

This body must render as **RichMarkdown**, not raw punctuation or opaque JSON.

### Inline and block card formats

Inline atom: :card[../MultiFormatSignal/sample | atom]

Inline embedded: :card[../MultiFormatSignal/sample | embedded]

Block fitted at an explicit footprint:

::card[../MultiFormatSignal/sample | fitted w:360 h:180]

Block isolated:

::card[../MultiFormatSignal/sample | isolated]

### Diagram

\`\`\`mermaid
flowchart LR
  Source[Rich markdown] --> Parse[BFM parser]
  Parse --> Inline[Inline atom]
  Parse --> Block[Block fitted or isolated]
\`\`\`
`;

module(
  'Integration | Boxel execution graph | Realm mirror compatibility',
  function (hooks) {
    setupRenderingTest(hooks);
    setupLocalIndexing(hooks);
    let mockMatrixUtils = setupMockMatrix(hooks, {
      loggedInAs: '@testuser:localhost',
      activeRealms: [testRealmURL],
      autostart: true,
    });
    setupRealmCacheTeardown(hooks);

    hooks.beforeEach(async function () {
      await withCachedRealmSetup(async () =>
        setupIntegrationTestRealm({
          mockMatrixUtils,
          contents: {
            'nested-field-host.gts': nestedFieldHostSource,
            'linked-project.gts': linkedProjectSource,
            'primitive-profile.gts': primitiveProfileSource,
            'multi-format-signal.gts': multiFormatSignalSource,
            'markdown-article.gts': markdownArticleSource,
            'browser-dependent-child.gts': browserDependentChildSource,
            'capsule-sandbox-parent.gts': capsuleSandboxParentSource,
            'NestedFieldHost/sample.json': {
              data: {
                type: 'card',
                attributes: {
                  title: 'Northlight Test Kitchen',
                  status: 'ready',
                  address: {
                    street: '18 Orchard Lane',
                    city: 'Hudson',
                    region: 'NY',
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: '../nested-field-host',
                    name: 'NestedFieldHost',
                  },
                },
              },
            },
            'Person/avery.json': {
              data: {
                type: 'card',
                attributes: { name: 'Avery Rivera', specialty: 'Systems' },
                meta: {
                  adoptsFrom: { module: '../linked-project', name: 'Person' },
                },
              },
            },
            'Person/mina.json': {
              data: {
                type: 'card',
                attributes: { name: 'Mina Okafor', specialty: 'Accessibility' },
                meta: {
                  adoptsFrom: { module: '../linked-project', name: 'Person' },
                },
              },
            },
            'Person/theo.json': {
              data: {
                type: 'card',
                attributes: {
                  name: 'Theo Park',
                  specialty: 'Editorial design',
                },
                meta: {
                  adoptsFrom: { module: '../linked-project', name: 'Person' },
                },
              },
            },
            'LinkedProject/sample.json': {
              data: {
                type: 'card',
                attributes: { title: 'Realm boundary compatibility' },
                relationships: {
                  owner: { links: { self: '../Person/avery' } },
                  'reviewers.0': { links: { self: '../Person/mina' } },
                  'reviewers.1': { links: { self: '../Person/theo' } },
                },
                meta: {
                  adoptsFrom: {
                    module: '../linked-project',
                    name: 'LinkedProject',
                  },
                },
              },
            },
            'PrimitiveProfile/sample.json': {
              data: {
                type: 'card',
                attributes: {
                  name: 'Avery Rivera',
                  role: 'Editorial Systems Lead',
                  weeklyHours: 32,
                  remote: true,
                },
                meta: {
                  adoptsFrom: {
                    module: '../primitive-profile',
                    name: 'PrimitiveProfile',
                  },
                },
              },
            },
            'MultiFormatSignal/sample.json': {
              data: {
                type: 'card',
                attributes: {
                  title: 'Harbor relay 7',
                  status: 'Nominal',
                  channel: 'VHF · 156.8 MHz',
                  description:
                    'One card identity rendered through four authored formats.',
                },
                meta: {
                  adoptsFrom: {
                    module: '../multi-format-signal',
                    name: 'MultiFormatSignal',
                  },
                },
              },
            },
            'MarkdownArticle/sample.json': {
              data: {
                type: 'card',
                attributes: {
                  title: 'The boundary should disappear',
                  dek: 'Trusted Base rendering composes with authored cards.',
                  body: { content: richMarkdownContent },
                },
                meta: {
                  adoptsFrom: {
                    module: '../markdown-article',
                    name: 'MarkdownArticle',
                  },
                },
              },
            },
            'BrowserDependentChild/sample.json': {
              data: {
                type: 'card',
                attributes: { label: 'Browser child' },
                meta: {
                  adoptsFrom: {
                    module: '../browser-dependent-child',
                    name: 'BrowserDependentChild',
                  },
                },
              },
            },
            'CapsuleSandboxParent/sample.json': {
              data: {
                type: 'card',
                attributes: { title: 'Alternating owner parent' },
                relationships: {
                  child: {
                    links: { self: '../BrowserDependentChild/sample' },
                  },
                },
                meta: {
                  adoptsFrom: {
                    module: '../capsule-sandbox-parent',
                    name: 'CapsuleSandboxParent',
                  },
                },
              },
            },
          },
        }),
      );
    });

    setupCardLogs(hooks, async () =>
      getService('loader-service').loader.import('@cardstack/base/card-api'),
    );

    // Rendering tests do not enter ApplicationRoute.beforeModel, where the
    // production Host installs this trusted lazy-loading bridge. Exercise the
    // same bridge here so G-05 proves the real editable Base surface instead
    // of stopping at CodeMirror's loading placeholder.
    hooks.beforeEach(function () {
      (globalThis as any).__loadCodeMirror = async () => cmContext;
    });
    hooks.afterEach(function () {
      delete (globalThis as any).__loadCodeMirror;
    });

    async function loadSample(): Promise<BaseDef> {
      return (await getService('store').get(
        `${testRealmURL}NestedFieldHost/sample`,
      )) as BaseDef;
    }

    async function renderSample(card: BaseDef, format: 'isolated' | 'edit') {
      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            {{! Omission is intentional: automatic policy routing is the safe
              CardRenderer default for every top-level Boxel. }}
            <CardRenderer
              class='runtime-scroll-host'
              @card={{card}}
              @format={{format}}
            />
          </template>
        },
      );
    }

    test('G-01/G-02 | RP-6.4: an ordinary top-level CardRenderer call routes a mirror card through Capsule and preserves nested FieldDef delegation', async function (assert) {
      let card = await loadSample();

      await renderSample(card, 'isolated');
      await waitFor(
        '[data-boxel-execution="capsule"] [data-corpus="nested-field"]',
        { timeout: 10000 },
      );

      assert
        .dom('[data-boxel-execution="capsule"]')
        .hasAttribute(
          'data-boxel-execution-reason',
          'default-user-card',
          'authored source enters the policy-selected Capsule tier',
        );
      assert
        .dom('[data-corpus="nested-field-host"] h1')
        .hasText('Northlight Test Kitchen');
      assert
        .dom('[data-corpus="nested-field"]')
        .containsText('18 Orchard Lane');
      assert.dom('[data-corpus="nested-field"]').containsText('Hudson, NY');
    });

    test('RP-6.3, RP-6.4: the same mirror card resolves its missing authored edit format to the Direct trusted Base surface', async function (assert) {
      let card = await loadSample();

      await renderSample(card, 'edit');
      await waitFor(
        '[data-boxel-execution="direct"] [data-test-base-template="edit"]',
        { timeout: 10000 },
      );

      assert
        .dom('[data-boxel-execution="direct"]')
        .hasAttribute(
          'data-boxel-execution-reason',
          'default-user-card',
          'the authored definition remains policy-classified as user code while its missing edit format resolves to a trusted Direct provider',
        );
      assert
        .dom('[data-corpus="nested-field-host"]')
        .doesNotExist('the authored isolated template is not reused for edit');
      assert
        .dom('[data-test-base-template="edit"]')
        .exists('trusted Base owns the standard edit surface');
      assert
        .dom(
          '[data-boxel-execution="direct"] > .boxel-card-container.runtime-scroll-host',
        )
        .exists(
          'host layout attributes reach the Direct card root, so its default edit surface keeps the caller-owned scroll behavior',
        );
      let values = [
        ...document.querySelectorAll<HTMLInputElement>('input'),
      ].map((input) => input.value);
      for (let expected of [
        'Northlight Test Kitchen',
        '18 Orchard Lane',
        'Hudson',
        'NY',
      ]) {
        assert.true(
          values.includes(expected),
          `the default editor contains the '${expected}' field value`,
        );
      }
      assert
        .dom('[data-test-field="status"]')
        .containsText('ready', 'the generated enum field renders in edit');
      assert
        .dom('[data-test-field="address"]')
        .containsText(
          '18 Orchard Lane',
          'fields after the generated enum continue rendering',
        );
    });

    test('G-04 | RP-2.6, RP-6.4, RP-8.4: relationship-backed mirror composition loads and delegates one and many linked cards inside Capsule', async function (assert) {
      let card = (await getService('store').get(
        `${testRealmURL}LinkedProject/sample`,
      )) as BaseDef;

      await renderSample(card, 'isolated');
      await waitFor(
        '[data-boxel-execution="capsule"] [data-corpus="linked-person"]',
        { timeout: 10000 },
      );
      await waitUntil(
        () =>
          document.querySelectorAll('[data-corpus="linked-person"]').length ===
          2,
        { timeout: 10000 },
      );

      assert
        .dom('[data-boxel-execution="capsule"]')
        .hasAttribute('data-boxel-execution-reason', 'default-user-card');
      assert
        .dom('[data-corpus="linked-project"] h1')
        .hasText('Realm boundary compatibility');
      assert
        .dom('[data-corpus="linked-person"]')
        .exists(
          { count: 2 },
          'both explicitly embedded reviewers use the authored Person template',
        );
      assert
        .dom('[data-corpus="linked-project"]')
        .containsText(
          'Untitled Corpus Person',
          'the owner omits an explicit format and follows the isolated-to-fitted cascade through the Base fallback',
        );
      assert.dom('[data-corpus="linked-project"]').containsText('Mina Okafor');
      assert
        .dom('[data-corpus="linked-project"]')
        .containsText('Accessibility');
      assert.dom('[data-corpus="linked-project"]').containsText('Theo Park');
      assert
        .dom('[data-corpus="linked-project"]')
        .containsText('Editorial design');
    });

    test('RP-4.1, RP-6.4, RP-11.2: a primitive mirror preserves function-form computeVia and presentation metadata in Capsule', async function (assert) {
      let card = (await getService('store').get(
        `${testRealmURL}PrimitiveProfile/sample`,
      )) as BaseDef;

      await renderSample(card, 'isolated');
      await waitFor(
        '[data-boxel-execution="capsule"] [data-corpus="primitive-profile"]',
        { timeout: 10000 },
      );

      assert
        .dom('[data-corpus="primitive-profile"] h1')
        .hasText('Avery Rivera');
      assert
        .dom('[data-corpus="primitive-profile"] .role')
        .hasText('Editorial Systems Lead');
      assert
        .dom('[data-corpus="primitive-profile"] .capacity')
        .hasText('32 hours · remote');
      assert.true(
        (card.constructor as unknown as { prefersWideFormat?: boolean })
          .prefersWideFormat,
        'the canonical Store type retains its presentation static',
      );
    });

    test('G-10 | RP-2.6, RP-6.4: authored embedded and fitted formats from one mirror module remain independently selectable in Capsule', async function (assert) {
      let card = (await getService('store').get(
        `${testRealmURL}PrimitiveProfile/sample`,
      )) as BaseDef;

      await renderComponent(
        class TestDriver extends GlimmerComponent {
          <template>
            <CardRenderer @card={{card}} @format='embedded' />
            <CardRenderer @card={{card}} @format='fitted' />
          </template>
        },
      );
      await waitFor('[data-corpus="primitive-profile-embedded"]', {
        timeout: 10000,
      });
      await waitFor('[data-corpus="primitive-profile-fitted"]', {
        timeout: 10000,
      });

      assert
        .dom('[data-corpus="primitive-profile-embedded"]')
        .hasText('Avery Rivera · Editorial Systems Lead');
      assert
        .dom('[data-corpus="primitive-profile-fitted"]')
        .hasText('Avery Rivera');
      assert
        .dom('[data-boxel-execution="capsule"]')
        .exists({ count: 2 }, 'each top-level authored format uses Capsule');
    });

    test('G-05 | RP-2.6, RP-6.3, RP-6.4: a trusted RichMarkdown FieldDef composes authored atom, embedded, fitted, and isolated cards inside Capsule', async function (assert) {
      let card = (await getService('store').get(
        `${testRealmURL}MarkdownArticle/sample`,
      )) as BaseDef;

      await renderSample(card, 'isolated');
      await waitFor('[data-corpus="multi-format-signal-atom"]', {
        timeout: 10000,
      });
      await waitFor('[data-corpus="multi-format-signal-embedded"]', {
        timeout: 10000,
      });
      await waitFor('[data-corpus="multi-format-signal-fitted"]', {
        timeout: 10000,
      });
      await waitFor('[data-corpus="multi-format-signal"]', { timeout: 10000 });

      assert
        .dom('[data-boxel-execution="capsule"]')
        .hasAttribute('data-boxel-execution-reason', 'default-user-card');
      assert
        .dom('[data-corpus="markdown-article"] h1')
        .hasText('The boundary should disappear');
      assert.dom('.body h2').hasText('Visible proof');
      assert.dom('.body strong').containsText('RichMarkdown');
      assert
        .dom('[data-corpus="multi-format-signal-atom"]')
        .containsText('Nominal');
      assert
        .dom('[data-corpus="multi-format-signal-embedded"]')
        .containsText('Harbor relay 7');
      assert
        .dom('[data-corpus="multi-format-signal-fitted"]')
        .containsText('Multi-format compatibility');
      assert
        .dom('[data-corpus="multi-format-signal"] h1')
        .hasText('Harbor relay 7');
    });

    test('G-06 | a Capsule parent re-enters Host policy for a browser-dependent linked child', async function (assert) {
      let childClassification = await classifyBoxelSource(
        browserDependentChildSource,
      );
      assert.strictEqual(childClassification.tier, 'sandbox');
      assert.strictEqual(
        childClassification.reason,
        'browser-runtime:ember-modifier',
        'the independently loaded child requires browser authority',
      );

      let card = (await getService('store').get(
        `${testRealmURL}CapsuleSandboxParent/sample`,
      )) as BaseDef;

      await renderSample(card, 'isolated');
      await waitFor(
        '[data-boxel-execution="capsule"] [data-corpus="capsule-sandbox-parent"]',
        { timeout: 10000 },
      );
      await waitFor(
        '[data-boxel-execution="capsule"] [data-boxel-execution="sandbox"] iframe.boxel-sandbox-process',
        { timeout: 10000 },
      );

      assert
        .dom('[data-corpus="capsule-sandbox-parent"] h1')
        .hasText('Alternating owner parent');
      assert
        .dom(
          '[data-boxel-execution="capsule"] [data-boxel-execution="sandbox"]',
        )
        .exists(
          'Host policy routes the linked child to a real Sandbox process mount',
        );
      assert
        .dom(
          '[data-boxel-execution="sandbox"] > [data-corpus="browser-dependent-child"]',
        )
        .doesNotExist(
          'browser-dependent authored DOM is not executed as a live Host child',
        );
      assert
        .dom(
          '[data-boxel-execution="sandbox"] > .boxel-execution-placeholder [data-corpus="browser-dependent-child"]',
        )
        .exists(
          'the inert prerender remains visible while the real Sandbox process boots',
        );
    });

    test('RP-6.3, RP-8.3: the RichMarkdown mirror resolves edit to the trusted Base editor without becoming read-only at the boundary', async function (assert) {
      let card = (await getService('store').get(
        `${testRealmURL}MarkdownArticle/sample`,
      )) as BaseDef;

      await renderSample(card, 'edit');
      await waitFor(
        '[data-boxel-execution="direct"] [data-test-base-template="edit"]',
        { timeout: 10000 },
      );
      await waitFor('[data-test-codemirror-editor]', { timeout: 10000 });

      assert
        .dom('[data-boxel-execution="direct"]')
        .hasAttribute('data-boxel-execution-reason', 'default-user-card');
      assert
        .dom('[data-test-base-template="edit"]')
        .exists('the Host-owned standard edit surface is selected');
      assert
        .dom('[data-test-codemirror-editor]')
        .exists('the editable CodeMirror control completed lazy loading');
    });
  },
);
