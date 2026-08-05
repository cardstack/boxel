import { click, settled, waitFor, waitUntil } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, isCardErrorJSONAPI, rri } from '@cardstack/runtime-common';

import config from '@cardstack/host/config/environment';

import type CardTypeService from '@cardstack/host/services/card-type-service';
import type EnvironmentService from '@cardstack/host/services/environment-service';
import type MonacoService from '@cardstack/host/services/monaco-service';
import type RealmSandboxService from '@cardstack/host/services/realm-sandbox';
import type StoreService from '@cardstack/host/services/store';

import {
  setupAcceptanceTestRealm,
  setupAuthEndpoints,
  setupLocalIndexing,
  setupOnSave,
  setupRealmCacheTeardown,
  setupUserSubscription,
  SYSTEM_CARD_FIXTURE_CONTENTS,
  setMonacoContent,
  testRealmURL,
  visitOperatorMode,
  withCachedRealmSetup,
  realmConfigCardJSON,
} from '../../helpers';
import { CardsGrid, setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setPlaygroundSelections } from '../../helpers/playground';
import { setupApplicationTest } from '../../helpers/setup';

const livePreviewSource = `
import { CardDef, Component } from '@cardstack/base/card-api';

export class LivePreview extends CardDef {
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article data-test-live-preview>
        <strong>VERSION ONE</strong>
      </article>
    </template>
  };
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <span data-test-live-preview-embedded>EMBEDDED VERSION ONE</span>
    </template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template>
      <form data-test-live-preview-edit>EDIT VERSION ONE</form>
    </template>
  };
}
`;

const iframeLivePreviewSource = `
const sandboxDocument = document;
${livePreviewSource.split('LivePreview').join('IframeLivePreview')}
void sandboxDocument;
`;

const dormantBrowserAdapterSource = `
export function browserTitle() {
  return document.title;
}
`;

const ordinaryLibrarySource = `
import { browserTitle } from './dormant-browser-adapter';

export const ordinaryLabel = 'COLD INTERACT RENDERED';
export { browserTitle };
`;

const coldInteractSource = `
import { CardDef, Component } from '@cardstack/base/card-api';
import { ordinaryLabel } from './ordinary-library';

export class ColdInteract extends CardDef {
  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article data-test-cold-interact>{{ordinaryLabel}}</article>
    </template>
  };
}
`;

const nestedFieldSource = `
import { get } from '@ember/helper';
import { on } from '@ember/modifier';
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  field,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class DetailField extends FieldDef {
  @field label = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    update = () => this.args.set?.({ label: 'Nested authored field updated' });

    <template>
      <strong data-test-nested-field>{{@model.label}}</strong>
      <button type='button' data-test-update-nested-field {{on 'click' this.update}}>
        Update nested field
      </button>
    </template>
  };
}

export class NestedFieldHost extends CardDef {
  @field detail = contains(DetailField);
  @field details = containsMany(DetailField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article data-test-nested-field-host>
        <@fields.detail />
        {{#each @model.details as |_detail index|}}
          {{#let (get @fields.details index) as |Detail|}}
            <Detail />
          {{/let}}
        {{/each}}
      </article>
    </template>
  };
}
`;

const computedProjectionSource = `
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  field,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';

export class CostInputs extends FieldDef {
  @field units = contains(NumberField);
  @field unitCost = contains(NumberField);
  @field subtotal = contains(NumberField, {
    computeVia: function () {
      return this.units * this.unitCost;
    },
  });
}

export class ProfitProjection extends FieldDef {
  @field revenue = contains(NumberField);
  @field cost = contains(NumberField);
  @field contribution = contains(NumberField, {
    computeVia: function () {
      return this.revenue - this.cost;
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <strong data-test-computed-profit>{{@model.contribution}}</strong>
    </template>
  };
}

export class ComputedProjection extends CardDef {
  @field revenue = contains(NumberField);
  @field costs = contains(CostInputs);
  @field totalCost = contains(NumberField, {
    computeVia: function () {
      return this.costs.subtotal;
    },
  });
  @field profit = contains(ProfitProjection, {
    computeVia: function () {
      let profit = new ProfitProjection();
      Object.assign(profit, {
        revenue: this.revenue,
        cost: this.totalCost,
      });
      return profit;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article data-test-computed-projection>
        <span data-test-computed-subtotal>{{@model.costs.subtotal}}</span>
        <span data-test-computed-total>{{@model.totalCost}}</span>
        <@fields.profit />
      </article>
    </template>
  };
}
`;

const relationshipSource = `
import { tracked } from '@glimmer/tracking';
import { get } from '@ember/helper';
import { on } from '@ember/modifier';
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
  @field name = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template><strong data-test-related-person data-test-related-person-format='embedded'>{{@model.name}}</strong></template>
  };
  static fitted = class Fitted extends Component<typeof this> {
    <template><strong data-test-related-person data-test-related-person-format='fitted'>{{@model.name}}</strong></template>
  };
}

export class Project extends CardDef {
  @field owner = linksTo(Person);
  @field reviewers = linksToMany(Person);

  static isolated = class Isolated extends Component<typeof this> {
    @tracked parentRevision = 0;
    rerenderParent = () => this.parentRevision++;

    <template>
      <article data-test-related-project>
        <button
          type='button'
          data-test-rerender-related-project
          {{on 'click' this.rerenderParent}}
        >Rerender parent {{this.parentRevision}}</button>
        <@fields.owner />
        {{#each @model.reviewers as |_reviewer index|}}
          {{#let (get @fields.reviewers index) as |Reviewer|}}
            <Reviewer @format='embedded' />
          {{/let}}
        {{/each}}
      </article>
    </template>
  };
}
`;

const formatCompatibilitySource = `
import {
  CardDef,
  Component,
  contains,
  field,
  linksTo,
} from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';

export class FormatTarget extends CardDef {
  @field label = contains(StringField);

  static isolated = class Isolated extends Component<typeof this> {
    <template><article class='format-proof' data-test-corpus-format='isolated'>{{@model.label}} isolated</article></template>
  };
  static embedded = class Embedded extends Component<typeof this> {
    <template><span data-test-corpus-format='embedded'>{{@model.label}} embedded</span></template>
  };
  static fitted = class Fitted extends Component<typeof this> {
    <template><span data-test-corpus-format='fitted'>{{@model.label}} fitted</span></template>
  };
  static atom = class Atom extends Component<typeof this> {
    <template><span data-test-corpus-format='atom'>{{@model.label}} atom</span></template>
  };
  static edit = class Edit extends Component<typeof this> {
    <template><label data-test-corpus-format='edit'>{{@model.label}} edit</label></template>
  };
  static head = class Head extends Component<typeof this> {
    <template><meta data-test-corpus-format='head' name='format-proof' content={{@model.label}} /></template>
  };
  static markdown = class Markdown extends Component<typeof this> {
    <template><code data-test-corpus-format='markdown'>{{@model.label}} markdown</code></template>
  };
}

export class FormatCompatibility extends CardDef {
  @field target = linksTo(FormatTarget);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section data-test-format-compatibility>
        <@fields.target @format='embedded' />
        <@fields.target @format='fitted' />
        <@fields.target @format='atom' />
        <@fields.target @format='edit' />
        <@fields.target @format='head' />
        <@fields.target @format='markdown' />
      </section>
    </template>
  };
}
`;

const richMarkdownCompatibilitySource = `
import {
  CardDef,
  Component,
  contains,
  field,
} from '@cardstack/base/card-api';
import { RichMarkdownField } from '@cardstack/base/rich-markdown';

export class RichMarkdownCompatibility extends CardDef {
  @field body = contains(RichMarkdownField);

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <article data-test-rich-markdown-compatibility>
        <@fields.body @format='embedded' />
      </article>
    </template>
  };
}
`;

const recursiveCompatibilitySource = `
import {
  CardDef,
  Component,
  FieldDef,
  contains,
  containsMany,
  field,
} from '@cardstack/base/card-api';
import NumberField from '@cardstack/base/number';
import StringField from '@cardstack/base/string';

export class CommentField extends FieldDef {
  @field body = contains(StringField);
  @field replies = containsMany(() => CommentField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <article data-test-recursive-comment>
        <strong>{{@model.body}}</strong>
        <@fields.replies @format='embedded' />
      </article>
    </template>
  };
}

export class ExperienceRoot extends CardDef {
  @field category = contains(StringField);
}

export class RecursiveCompatibility extends ExperienceRoot {
  @field comments = containsMany(CommentField);
  @field guesses = containsMany(NumberField);
  @field attempts = contains(NumberField, {
    computeVia: function () {
      return this.guesses.length;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    <template>
      <section data-test-recursive-compatibility>
        <h2>{{@model.category}} · {{@model.attempts}}</h2>
        <@fields.comments @format='embedded' />
      </section>
    </template>
  };
}
`;

const compileBrokenLivePreviewSource = livePreviewSource.replace(
  '<strong>VERSION ONE</strong>',
  '<strong>{{</strong>',
);

const renderBrokenLivePreviewSource = livePreviewSource
  .replace(
    '    <template>',
    `    get brokenPreview() {
      throw new Error('BROKEN SANDBOX PREVIEW RENDER');
    }

    <template>`,
  )
  .replace('VERSION ONE', '{{this.brokenPreview}}');

const repairedLivePreviewSource = livePreviewSource.replace(
  'VERSION ONE',
  'VERSION TWO',
);

const wideLivePreviewSource = livePreviewSource.replace(
  'export class LivePreview extends CardDef {',
  `export class LivePreview extends CardDef {
  static prefersWideFormat = true;`,
);

function typeAtEndOfMarker(marker: string, text: string) {
  let monaco = getService('monaco-service') as MonacoService;
  let editor = monaco.editor;
  let model = editor?.getModel();
  if (!editor || !model) {
    throw new Error('Monaco editor is not ready');
  }
  let offset = model.getValue().indexOf(marker);
  if (offset === -1) {
    throw new Error(`Could not find ${marker} in Monaco`);
  }
  editor.setPosition(model.getPositionAt(offset + marker.length));
  editor.trigger('sandbox-live-reload-test', 'type', { text });
}

module('Acceptance | code submode | sandbox live reload', function (hooks) {
  setupApplicationTest(hooks);
  setupLocalIndexing(hooks);
  setupOnSave(hooks);
  setupRealmCacheTeardown(hooks);
  setupBaseRealm(hooks);

  let originalIframeOrigin: string | undefined;

  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms: [baseRealm.url, testRealmURL],
  });

  hooks.beforeEach(async function () {
    originalIframeOrigin = config.realmSandboxIframeOrigin;
    // Testem disables application autoboot in a second browsing context, so
    // this suite exercises the persistent host boundary against an inert
    // origin. Child-confirmed generations are covered by the protocol tests
    // and the staging-backed browser smoke test; the host must never infer a
    // child acknowledgement from publication alone.
    config.realmSandboxIframeOrigin = 'https://127.0.0.1:1';
    mockMatrixUtils.setRealmPermissions({
      [testRealmURL]: ['read', 'write'],
    });
    await mockMatrixUtils.createAndJoinRoom({
      sender: '@testuser:localhost',
      name: 'sandbox-live-reload',
    });
    setupUserSubscription();
    setupAuthEndpoints();

    await withCachedRealmSetup(async () => {
      await setupAcceptanceTestRealm({
        mockMatrixUtils,
        contents: {
          ...SYSTEM_CARD_FIXTURE_CONTENTS,
          'index.json': new CardsGrid(),
          'realm.json': realmConfigCardJSON({ name: 'Hot Reload Test Realm' }),
          'live-preview-compartment.gts': livePreviewSource,
          'live-preview-iframe.gts': iframeLivePreviewSource,
          'dormant-browser-adapter.ts': dormantBrowserAdapterSource,
          'ordinary-library.ts': ordinaryLibrarySource,
          'cold-interact.gts': coldInteractSource,
          'nested-field.gts': nestedFieldSource,
          'computed-projection.gts': computedProjectionSource,
          'relationship.gts': relationshipSource,
          'format-compatibility.gts': formatCompatibilitySource,
          'rich-markdown-compatibility.gts': richMarkdownCompatibilitySource,
          'recursive-compatibility.gts': recursiveCompatibilitySource,
          'live-preview-compartment-entry.json': {
            data: {
              type: 'card',
              attributes: {
                specType: 'card',
                ref: {
                  module: `${testRealmURL}live-preview-compartment`,
                  name: 'LivePreview',
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${baseRealm.url}spec`,
                  name: 'Spec',
                },
              },
            },
          },
          'live-preview-iframe-entry.json': {
            data: {
              type: 'card',
              attributes: {
                specType: 'card',
                ref: {
                  module: `${testRealmURL}live-preview-iframe`,
                  name: 'IframeLivePreview',
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${baseRealm.url}spec`,
                  name: 'Spec',
                },
              },
            },
          },
          'LivePreview/sample.json': {
            data: {
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}live-preview-compartment`,
                  name: 'LivePreview',
                },
              },
            },
          },
          'IframeLivePreview/sample.json': {
            data: {
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}live-preview-iframe`,
                  name: 'IframeLivePreview',
                },
              },
            },
          },
          'ColdInteract/sample.json': {
            data: {
              attributes: {},
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}cold-interact`,
                  name: 'ColdInteract',
                },
              },
            },
          },
          'NestedFieldHost/sample.json': {
            data: {
              attributes: {
                detail: { label: 'Nested authored field rendered' },
                details: [
                  { label: 'First indexed field rendered' },
                  { label: 'Second indexed field rendered' },
                ],
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}nested-field`,
                  name: 'NestedFieldHost',
                },
              },
            },
          },
          'ComputedProjection/sample.json': {
            data: {
              attributes: {
                revenue: 300,
                costs: { units: 4, unitCost: 25 },
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}computed-projection`,
                  name: 'ComputedProjection',
                },
              },
            },
          },
          'Person/owner.json': {
            data: {
              attributes: { name: 'Avery Owner' },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}relationship`,
                  name: 'Person',
                },
              },
            },
          },
          'Person/reviewer-one.json': {
            data: {
              attributes: { name: 'Mina Reviewer' },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}relationship`,
                  name: 'Person',
                },
              },
            },
          },
          'Person/reviewer-two.json': {
            data: {
              attributes: { name: 'Theo Reviewer' },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}relationship`,
                  name: 'Person',
                },
              },
            },
          },
          'Project/sample.json': {
            data: {
              attributes: {},
              relationships: {
                owner: {
                  links: { self: `${testRealmURL}Person/owner` },
                },
                'reviewers.0': {
                  links: { self: `${testRealmURL}Person/reviewer-one` },
                },
                'reviewers.1': {
                  links: { self: `${testRealmURL}Person/reviewer-two` },
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}relationship`,
                  name: 'Project',
                },
              },
            },
          },
          'FormatTarget/sample.json': {
            data: {
              attributes: { label: 'FORMAT TARGET' },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}format-compatibility`,
                  name: 'FormatTarget',
                },
              },
            },
          },
          'FormatCompatibility/sample.json': {
            data: {
              attributes: {},
              relationships: {
                target: {
                  links: { self: `${testRealmURL}FormatTarget/sample` },
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}format-compatibility`,
                  name: 'FormatCompatibility',
                },
              },
            },
          },
          'RichMarkdownCompatibility/sample.json': {
            data: {
              attributes: {
                body: {
                  content:
                    '## Boundary-safe document\n\n- one\n- two\n\n| Capability | Result |\n| --- | --- |\n| SES | pass |\n\n```mermaid\nflowchart LR\n  A --> B\n```',
                },
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}rich-markdown-compatibility`,
                  name: 'RichMarkdownCompatibility',
                },
              },
            },
          },
          'RecursiveCompatibility/sample.json': {
            data: {
              attributes: {
                category: 'Inherited category',
                guesses: [4, 8, 15],
                comments: [
                  {
                    body: 'Root comment',
                    replies: [
                      {
                        body: 'Nested comment',
                        replies: [{ body: 'Deep comment', replies: [] }],
                      },
                    ],
                  },
                ],
              },
              meta: {
                adoptsFrom: {
                  module: `${testRealmURL}recursive-compatibility`,
                  name: 'RecursiveCompatibility',
                },
              },
            },
          },
        },
      });
    });
  });

  hooks.afterEach(function () {
    config.realmSandboxIframeOrigin = originalIframeOrigin;
  });

  test('[COLD-INTERACT-01] an ordinary card renders when a transitive library contains a dormant browser adapter', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      stacks: [
        [
          {
            id: `${testRealmURL}ColdInteract/sample`,
            format: 'isolated',
          },
        ],
      ],
    });

    await waitFor('[data-test-cold-interact]');
    assert.dom('[data-test-cold-interact]').hasText('COLD INTERACT RENDERED');
    assert
      .dom('[data-card-sandbox-loading]')
      .doesNotExist('cold Interact reaches authored DOM instead of waiting');
    assert
      .dom('.realm-sandbox-iframe')
      .doesNotExist('the dormant adapter remains confined and unused in SES');
  });

  test('[COLD-INTERACT-02] a user-authored contains FieldDef delegates its embedded template through SES', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      stacks: [
        [
          {
            id: `${testRealmURL}NestedFieldHost/sample`,
            format: 'isolated',
          },
        ],
      ],
    });

    await waitUntil(
      () => document.querySelectorAll('[data-test-nested-field]').length === 3,
    );
    assert
      .dom('[data-test-nested-field]')
      .exists({ count: 3 }, 'singular and many FieldDefs all delegate');
    assert
      .dom('[data-test-nested-field-host]')
      .includesText('First indexed field rendered');
    assert
      .dom('[data-test-nested-field-host]')
      .includesText('Second indexed field rendered');
    assert
      .dom('[data-test-nested-field-host]')
      .doesNotIncludeText('{"label"', 'the boundary does not stringify it');

    await click('[data-test-update-nested-field]');
    await waitUntil(
      () =>
        document
          .querySelector('[data-test-nested-field]')
          ?.textContent?.includes('Nested authored field updated') === true,
    );
    assert
      .dom('[data-test-nested-field]')
      .includesText(
        'Nested authored field updated',
        'the existing @set contract crosses the delegated SES FieldDef boundary',
      );
    assert
      .dom('.realm-sandbox-iframe')
      .doesNotExist('a data-only field mutation remains in SES');
  });

  test('[COLD-INTERACT-02B] SES materializes nested, chained, and computed FieldDef projections', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      stacks: [
        [
          {
            id: `${testRealmURL}ComputedProjection/sample`,
            format: 'isolated',
          },
        ],
      ],
    });

    await waitFor('[data-test-computed-projection]');
    assert.dom('[data-test-computed-subtotal]').hasText('100');
    assert.dom('[data-test-computed-total]').hasText('100');
    assert
      .dom('[data-test-computed-profit]')
      .hasText('200', 'the computed FieldDef result also materializes');
    assert
      .dom('[data-card-sandbox-loading]')
      .doesNotExist('projection and template both settle into authored DOM');
    assert
      .dom('.realm-sandbox-iframe')
      .doesNotExist('the SES-safe computed graph never opens an iframe');
  });

  test('[COLD-INTERACT-03] linksTo and linksToMany delegate loaded child cards through SES', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      stacks: [
        [
          {
            id: `${testRealmURL}Project/sample`,
            format: 'isolated',
          },
        ],
      ],
    });

    await waitFor('[data-test-rerender-related-project]');
    let rerenderButton = document.querySelector<HTMLButtonElement>(
      '[data-test-rerender-related-project]',
    );
    if (!rerenderButton) {
      throw new Error('could not find the relationship rerender fixture');
    }
    // Exercise the async portal while unrelated tracked parent state changes.
    // The modifier must not treat each parent render as a new card generation
    // and starve the in-flight Store load.
    for (let i = 0; i < 5; i++) {
      rerenderButton.click();
      await Promise.resolve();
    }

    await waitUntil(
      () =>
        document.querySelectorAll('[data-test-related-person]').length === 3,
    );
    assert
      .dom('[data-test-related-person]')
      .exists({ count: 3 }, 'the owner and both reviewers render as cards');
    assert
      .dom('[data-test-related-person-format="fitted"]')
      .exists(
        { count: 1 },
        'an implicit linksTo child uses Base fitted format',
      );
    assert
      .dom('[data-test-related-person-format="embedded"]')
      .exists({ count: 2 }, 'explicit linksToMany formats remain embedded');
    assert.dom('[data-test-related-project]').includesText('Avery Owner');
    assert.dom('[data-test-related-project]').includesText('Mina Reviewer');
    assert.dom('[data-test-related-project]').includesText('Theo Reviewer');
  });

  test('[CORPUS-01] all CardDef formats render without blanking a delegated parent', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      stacks: [
        [
          {
            id: `${testRealmURL}FormatCompatibility/sample`,
            format: 'isolated',
          },
        ],
      ],
    });

    await waitFor('[data-test-format-compatibility]');
    // Base treats isolated as a top-level card format. The remaining formats
    // are valid delegated relationship formats and must all cross the sandbox
    // boundary without degrading to JSON.
    for (let format of [
      'embedded',
      'fitted',
      'atom',
      'edit',
      'head',
      'markdown',
    ]) {
      await waitFor(`[data-test-corpus-format="${format}"]`);
      assert
        .dom(`[data-test-corpus-format="${format}"]`)
        .exists(`${format} crossed the delegated card boundary`);
    }
    assert
      .dom('[data-test-format-compatibility]')
      .doesNotIncludeText('{"label"', 'no format degrades into opaque JSON');
    assert
      .dom('[data-card-sandbox-loading]')
      .doesNotExist('all delegated format programs have settled');
    assert
      .dom('.realm-sandbox-iframe')
      .doesNotExist('data-only authored formats remain in SES');

    await visitOperatorMode({
      submode: 'interact',
      stacks: [
        [
          {
            id: `${testRealmURL}FormatTarget/sample`,
            format: 'isolated',
          },
        ],
      ],
    });
    await waitFor('[data-test-corpus-format="isolated"]');
    assert
      .dom('[data-test-corpus-format="isolated"]')
      .includesText(
        'FORMAT TARGET isolated',
        'isolated renders as the top-level format',
      );
  });

  test('[CORPUS-02] RichMarkdown trusted field portal renders Mermaid and loads its editor', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      stacks: [
        [
          {
            id: `${testRealmURL}RichMarkdownCompatibility/sample`,
            format: 'isolated',
          },
        ],
      ],
    });

    await waitFor('[data-test-rich-markdown-compatibility]');
    assert
      .dom('[data-test-rich-markdown-compatibility]')
      .includesText('Boundary-safe document');
    assert
      .dom('[data-test-rich-markdown-compatibility] ul li')
      .exists({ count: 2 }, 'list structure renders instead of source text');
    assert
      .dom('[data-test-rich-markdown-compatibility] table')
      .exists('the markdown table renders');
    await waitFor('[data-test-rich-markdown-compatibility] pre.mermaid svg');
    assert
      .dom('[data-test-rich-markdown-compatibility] pre.mermaid svg')
      .exists('the trusted Mermaid shim renders the diagram');
    assert.dom('[data-card-sandbox-loading]').doesNotExist();

    await click('[data-test-edit-button]');
    await waitFor('[data-test-codemirror-editor] .cm-editor');
    assert
      .dom('[data-test-codemirror-editor] .cm-editor')
      .exists('the trusted CodeMirror shim replaces the loading state');
    assert.dom('[data-test-codemirror-loading]').doesNotExist();
  });

  test('[CORPUS-03] inherited fields, chained computeVia, and recursive containsMany compose in SES', async function (assert) {
    await visitOperatorMode({
      submode: 'interact',
      stacks: [
        [
          {
            id: `${testRealmURL}RecursiveCompatibility/sample`,
            format: 'isolated',
          },
        ],
      ],
    });

    await waitFor('[data-test-recursive-compatibility]');
    await waitFor('[data-test-recursive-comment]', { count: 3 });
    assert
      .dom('[data-test-recursive-compatibility] h2')
      .hasText('Inherited category · 3');
    assert
      .dom('[data-test-recursive-comment]')
      .exists({ count: 3 }, 'all recursive FieldDef levels delegate');
    assert
      .dom('[data-test-recursive-compatibility]')
      .includesText('Root comment');
    assert
      .dom('[data-test-recursive-compatibility]')
      .includesText('Nested comment');
    assert
      .dom('[data-test-recursive-compatibility]')
      .includesText('Deep comment');
    assert
      .dom('[data-test-recursive-compatibility]')
      .doesNotIncludeText('{"body"', 'recursive children never become JSON');
    assert.dom('.realm-sandbox-iframe').doesNotExist();
  });

  for (let sourceKind of ['ordinary', 'browser-runtime'] as const) {
    let testName =
      sourceKind === 'ordinary'
        ? '[HMR-01] a Monaco keystroke hot reloads the ordinary sandbox without replacing its renderer boundary'
        : '[IFR-HOST-01] a Monaco keystroke updates the persistent browser-runtime boundary without claiming child acknowledgement';
    test(testName, async function (assert) {
      let environment = getService('environment-service') as EnvironmentService;
      environment.autoSaveDelayMs = 1_000;

      let tier = sourceKind === 'ordinary' ? 'compartment' : 'iframe';

      setPlaygroundSelections({
        [`${testRealmURL}live-preview-${tier}/${tier === 'iframe' ? 'IframeLivePreview' : 'LivePreview'}`]:
          {
            cardId: rri(
              `${testRealmURL}${tier === 'iframe' ? 'IframeLivePreview' : 'LivePreview'}/sample`,
            ),
            format: 'isolated',
          },
      });

      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}live-preview-${tier}.gts`,
        codeSelection: tier === 'iframe' ? 'IframeLivePreview' : 'LivePreview',
        moduleInspector: 'preview',
        cardPreviewFormat: 'isolated',
      });

      await waitFor('[data-test-editor]');
      let realmSandbox = getService('realm-sandbox') as RealmSandboxService;
      let initialCommitCount =
        realmSandbox.metricsSnapshot().codePreviewCommitsPrepared;
      let initialAcknowledgementCount =
        realmSandbox.metricsSnapshot().codePreviewAcknowledgementsRecognized;
      let editorBecameReadOnly = false;
      let readOnlyIndicatorAppeared = false;
      let previewLoadingAppeared = false;
      let stablePreviewNode: Element | undefined;
      let editorObserver = new MutationObserver((records) => {
        editorBecameReadOnly ||= Boolean(
          document.querySelector('.monaco-container.readonly'),
        );
        readOnlyIndicatorAppeared ||= Boolean(
          document.querySelector('[data-test-realm-indicator-not-writable]'),
        );
        for (let record of records) {
          for (let node of record.addedNodes) {
            if (
              node instanceof Element &&
              (node.matches('[data-card-sandbox-loading]') ||
                node.querySelector('[data-card-sandbox-loading]'))
            ) {
              previewLoadingAppeared = true;
            }
          }
        }
      });
      editorObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['class'],
        childList: true,
        subtree: true,
      });
      if (sourceKind === 'ordinary') {
        await waitUntil(() => {
          return (
            Boolean(document.querySelector('[data-test-live-preview]')) ||
            Object.keys(realmSandbox.metricsSnapshot().compartmentErrors)
              .length > 0
          );
        });
        let compartmentErrors =
          realmSandbox.metricsSnapshot().compartmentErrors;
        if (Object.keys(compartmentErrors).length > 0) {
          throw new Error(
            `SES preview evaluation failed: ${JSON.stringify(compartmentErrors)}`,
          );
        }
        await waitFor('[data-test-live-preview]');
        let stableBoundary = document.querySelector('.realm-sandbox-render')!;
        let stableAuthoredNode = document.querySelector(
          '[data-test-live-preview]',
        )!;
        let stableTemplateIsland = document.querySelector(
          '[data-realm-sandbox-template-island]',
        )!;
        stablePreviewNode = stableAuthoredNode;
        assert.dom('[data-test-live-preview]').hasText('VERSION ONE');

        // The observer is installed before the initial sandbox is ready so it
        // can also catch writable-state flashes. Loading is expected only for
        // that first render; the assertion below covers the HMR/persistence
        // interval that starts here.
        previewLoadingAppeared = false;

        typeAtEndOfMarker('VERSION ONE', '!');

        await waitUntil(
          () =>
            document
              .querySelector('[data-test-live-preview]')
              ?.textContent?.trim() === 'VERSION ONE!',
        );
        assert.strictEqual(
          document.querySelector('.realm-sandbox-render'),
          stableBoundary,
          'the SES renderer boundary stayed mounted during the atomic template swap',
        );
        assert.strictEqual(
          document.querySelector('[data-realm-sandbox-template-island]'),
          stableTemplateIsland,
          'the SES template island stayed mounted during the atomic template swap',
        );
        assert.strictEqual(
          document.querySelector('[data-test-live-preview]'),
          stableAuthoredNode,
          'the authored preview DOM stayed mounted during the hot update',
        );
        assert
          .dom('[data-realm-sandbox-template-island]')
          .hasAttribute(
            'data-realm-sandbox-island-update',
            'adopted',
            'the replacement program adopted the serialized island',
          );
        assert
          .dom('[data-card-sandbox-diagnostics]')
          .hasAttribute('data-card-sandbox-tier', 'compartment');

        // The local draft update above is only the first half of HMR. Wait
        // through autosave, the +source response, realm indexing, and the
        // matching SSE acknowledgement before asserting identity again.
        await settled();
        assert.strictEqual(
          document.querySelector('.realm-sandbox-render'),
          stableBoundary,
          'the SES renderer boundary survived persistence and indexing',
        );
        assert.strictEqual(
          document.querySelector('[data-realm-sandbox-template-island]'),
          stableTemplateIsland,
          'the SES template island survived persistence and indexing',
        );
        assert.strictEqual(
          document.querySelector('[data-test-live-preview]'),
          stableAuthoredNode,
          'the authored preview DOM survived persistence and indexing',
        );
      } else {
        await waitFor('[data-card-sandbox-code-preview-loader="dedicated"]');
        let frameBoundary = document.querySelector(
          '[data-card-sandbox-code-preview-loader="dedicated"]',
        )!;
        let stableBoundary = frameBoundary.querySelector('iframe')!;
        stablePreviewNode = stableBoundary;
        let initialPublishedRevision = Number(
          frameBoundary.getAttribute('data-card-sandbox-draft-revision'),
        );
        assert.ok(initialPublishedRevision >= 0, 'initial draft was published');
        let initialAppliedRevision = Number(
          frameBoundary.getAttribute(
            'data-card-sandbox-applied-draft-revision',
          ),
        );
        assert.strictEqual(
          initialAppliedRevision,
          -1,
          'publication alone does not masquerade as child acknowledgement',
        );

        previewLoadingAppeared = false;

        typeAtEndOfMarker('VERSION ONE', '!');

        await waitUntil(() => {
          let boundary = document.querySelector(
            '[data-card-sandbox-code-preview-loader="dedicated"]',
          );
          return (
            Number(boundary?.getAttribute('data-card-sandbox-draft-revision')) >
            initialPublishedRevision
          );
        });
        frameBoundary = document.querySelector(
          '[data-card-sandbox-code-preview-loader="dedicated"]',
        )!;
        assert.strictEqual(
          frameBoundary.querySelector('iframe'),
          stableBoundary,
          'the browser-runtime preview reused its detached iframe boundary',
        );

        await settled();
        frameBoundary = document.querySelector(
          '[data-card-sandbox-code-preview-loader="dedicated"]',
        )!;
        assert.strictEqual(
          frameBoundary.querySelector('iframe'),
          stableBoundary,
          'the browser-runtime iframe survived persistence and indexing',
        );
      }
      editorObserver.disconnect();
      assert.false(
        editorBecameReadOnly,
        'the writable Monaco editor never flips to a transient read-only state',
      );
      assert.false(
        readOnlyIndicatorAppeared,
        'the read-only workspace indicator never flashes during persistence',
      );
      assert.true(
        stablePreviewNode?.isConnected,
        'the original preview node remains connected after persistence',
      );
      assert.false(
        previewLoadingAppeared,
        'the persisted acknowledgement never replaces the preview with loading UI',
      );
      assert.true(
        realmSandbox.metricsSnapshot().codePreviewCommitsPrepared >
          initialCommitCount,
        'the autosave registered the exact Monaco revision',
      );
      assert.true(
        realmSandbox.metricsSnapshot().codePreviewAcknowledgementsRecognized >
          initialAcknowledgementCount,
        'the matching realm event was consumed as an acknowledgement',
      );
    });
  }

  test('[HMR-02] opaque presentation metadata follows the current valid draft before persistence', async function (assert) {
    let environment = getService('environment-service') as EnvironmentService;
    environment.autoSaveDelayMs = 1_000;
    setPlaygroundSelections({
      [`${testRealmURL}live-preview-compartment/LivePreview`]: {
        cardId: rri(`${testRealmURL}LivePreview/sample`),
        format: 'isolated',
      },
    });

    await visitOperatorMode({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}live-preview-compartment.gts`,
      codeSelection: 'LivePreview',
      moduleInspector: 'preview',
      cardPreviewFormat: 'isolated',
    });

    await waitFor('[data-test-editor]');
    await waitFor('[data-test-live-preview]');
    let realmSandbox = getService('realm-sandbox') as RealmSandboxService;
    let initialCommitCount =
      realmSandbox.metricsSnapshot().codePreviewCommitsPrepared;
    assert
      .dom('[data-test-playground-panel] .playground-panel-content')
      .hasAttribute('style', 'max-width: 50rem;');

    setMonacoContent(wideLivePreviewSource);

    try {
      await waitUntil(
        () =>
          document
            .querySelector(
              '[data-test-playground-panel] .playground-panel-content',
            )
            ?.getAttribute('style') === 'max-width: 100%;',
      );
    } catch (error) {
      let card = (getService('store') as StoreService).peek(
        `${testRealmURL}LivePreview/sample`,
      );
      let introspection =
        card && !isCardErrorJSONAPI(card)
          ? (getService('card-type-service') as CardTypeService).introspect(
              card,
            )
          : undefined;
      throw new Error(
        `wide metadata did not reach the playground: ${JSON.stringify({
          introspection,
          metrics: realmSandbox.metricsSnapshot(),
        })}; cause: ${String(error)}`,
      );
    }
    assert.strictEqual(
      realmSandbox.metricsSnapshot().codePreviewCommitsPrepared,
      initialCommitCount,
      'the explicit metadata boundary updates from the local draft without waiting for save/index acknowledgement',
    );
    assert
      .dom('[data-test-live-preview]')
      .hasText('VERSION ONE', 'the authored preview stays mounted');

    setMonacoContent(livePreviewSource);
    await waitUntil(
      () =>
        document
          .querySelector(
            '[data-test-playground-panel] .playground-panel-content',
          )
          ?.getAttribute('style') === 'max-width: 50rem;',
    );
  });

  test('[NAV-07][IFR-01][IFR-02] two SES format islands stay warm and iframe format updates keep the child document', async function (assert) {
    setPlaygroundSelections({
      [`${testRealmURL}live-preview-compartment/LivePreview`]: {
        cardId: rri(`${testRealmURL}LivePreview/sample`),
        format: 'isolated',
      },
    });
    await visitOperatorMode({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}live-preview-compartment.gts`,
      codeSelection: 'LivePreview',
      moduleInspector: 'preview',
      cardPreviewFormat: 'isolated',
    });
    await waitFor('[data-test-live-preview]');
    let isolatedNode = document.querySelector('[data-test-live-preview]')!;

    await click('[data-test-format-chooser="embedded"]');
    if (
      !document.querySelector(
        '[data-realm-sandbox-render-slot-active="true"] [data-test-live-preview-embedded]',
      )
    ) {
      let slots = [...document.querySelectorAll('.realm-sandbox-render-slot')]
        .map((slot) => ({
          active: slot.getAttribute('data-realm-sandbox-render-slot-active'),
          format: slot
            .querySelector('[data-boxel-card-format]')
            ?.getAttribute('data-boxel-card-format'),
          hidden: slot.hasAttribute('hidden'),
          text: slot.textContent?.trim(),
        }))
        .slice(0, 3);
      throw new Error(
        `Embedded sandbox format did not activate: ${JSON.stringify({
          embeddedChooserClass: document
            .querySelector('[data-test-format-chooser="embedded"]')
            ?.getAttribute('class'),
          loading: Boolean(
            document.querySelector('[data-card-sandbox-loading]'),
          ),
          syntaxError: document
            .querySelector('[data-test-syntax-error]')
            ?.textContent?.trim(),
          slots,
        })}`,
      );
    }
    await waitFor(
      '[data-realm-sandbox-render-slot-active="true"] [data-test-live-preview-embedded]',
    );
    let embeddedNode = document.querySelector(
      '[data-test-live-preview-embedded]',
    )!;
    assert.true(
      isolatedNode.isConnected,
      'the first SES format remains mounted in the two-slot LRU',
    );

    await click('[data-test-format-chooser="isolated"]');
    await waitFor(
      '[data-realm-sandbox-render-slot-active="true"] [data-test-live-preview]',
    );
    assert.strictEqual(
      document.querySelector(
        '[data-realm-sandbox-render-slot-active="true"] [data-test-live-preview]',
      ),
      isolatedNode,
      'returning to the recent format reactivates its authored DOM',
    );
    assert.true(
      embeddedNode.isConnected,
      'the second SES format remains warm for the next switch',
    );

    setPlaygroundSelections({
      [`${testRealmURL}live-preview-iframe/IframeLivePreview`]: {
        cardId: rri(`${testRealmURL}IframeLivePreview/sample`),
        format: 'isolated',
      },
    });
    await visitOperatorMode({
      stacks: [],
      submode: 'code',
      codePath: `${testRealmURL}live-preview-iframe.gts`,
      codeSelection: 'IframeLivePreview',
      moduleInspector: 'preview',
      cardPreviewFormat: 'isolated',
    });
    await waitFor('[data-card-sandbox-code-preview-loader="dedicated"]');
    let iframe = document.querySelector(
      '[data-card-sandbox-code-preview-loader="dedicated"] iframe',
    )! as HTMLIFrameElement;
    let iframeURL = iframe.src;

    await click('[data-test-format-chooser="embedded"]');
    await waitFor(
      '[data-card-sandbox-code-preview-loader="dedicated"][data-boxel-card-format="embedded"]',
    );
    assert.strictEqual(
      document.querySelector(
        '[data-card-sandbox-code-preview-loader="dedicated"] iframe',
      ),
      iframe,
      'the iframe browsing context survives a format switch',
    );
    assert.strictEqual(
      iframe.src,
      iframeURL,
      'format is a MessageChannel update rather than iframe URL identity',
    );

    await click('[data-test-format-chooser="edit"]');
    await waitFor(
      '[data-card-sandbox-code-preview-loader="dedicated"][data-boxel-card-format="edit"]',
    );
    assert.strictEqual(
      document.querySelector(
        '[data-card-sandbox-code-preview-loader="dedicated"] iframe',
      ),
      iframe,
      'a browser-dependent custom edit template keeps the iframe browsing context',
    );
    assert.strictEqual(
      iframe.src,
      iframeURL,
      'custom edit is also selected through the persistent presentation protocol',
    );
  });

  for (let [failureKind, brokenSource] of [
    ['compile', compileBrokenLivePreviewSource],
    ['render', renderBrokenLivePreviewSource],
  ] as const) {
    test(`[HMR-05] a sandbox ${failureKind} failure uses the standard code-mode error surface and recovers`, async function (assert) {
      setPlaygroundSelections({
        [`${testRealmURL}live-preview-compartment/LivePreview`]: {
          cardId: rri(`${testRealmURL}LivePreview/sample`),
          format: 'isolated',
        },
      });

      await visitOperatorMode({
        stacks: [],
        submode: 'code',
        codePath: `${testRealmURL}live-preview-compartment.gts`,
        codeSelection: 'LivePreview',
        moduleInspector: 'preview',
        cardPreviewFormat: 'isolated',
      });

      await waitFor('[data-test-editor]');
      await waitFor('[data-test-live-preview]');
      setMonacoContent(brokenSource);

      await waitFor('[data-test-syntax-error]');
      assert
        .dom('[data-test-syntax-error]')
        .includesText(
          'Unable to render the current preview',
          'the sandbox error is explicit instead of leaving a blank preview column',
        );
      assert
        .dom('[data-test-live-preview]')
        .hasText(
          'VERSION ONE',
          'the realm-backed last-known-good preview remains visible',
        );
      let previewPanel = document.querySelector(
        '[data-test-playground-panel]',
      ) as HTMLElement;
      let errorOverlay = document.querySelector(
        '[data-test-module-preview-error]',
      ) as HTMLElement;
      let previewRect = previewPanel.getBoundingClientRect();
      let errorRect = errorOverlay.getBoundingClientRect();
      assert.strictEqual(
        getComputedStyle(errorOverlay).position,
        'absolute',
        'the error floats over the last-known-good preview',
      );
      let isBottomOverlay =
        errorRect.top > previewRect.top &&
        previewRect.bottom - errorRect.bottom < 40;
      assert.true(
        isBottomOverlay,
        'the error is inset along the bottom of the preview instead of displacing it',
      );
      assert
        .dom('[data-test-send-error-to-ai-assistant]')
        .exists('the standard Fix with AI action is available');
      assert
        .dom('[data-test-editor]')
        .exists('Monaco remains mounted while the preview is broken');

      setMonacoContent(repairedLivePreviewSource);
      // The last-known-good island intentionally remains mounted while the
      // repaired generation compiles. Waiting for the selector alone returns
      // immediately against that older island, so synchronize on the new
      // generation's observable content instead.
      await waitUntil(
        () =>
          document
            .querySelector('[data-test-live-preview]')
            ?.textContent?.trim() === 'VERSION TWO',
      );
      assert
        .dom('[data-test-live-preview]')
        .hasText(
          'VERSION TWO',
          'a valid later generation restores the preview',
        );
      assert
        .dom('[data-test-syntax-error]')
        .doesNotExist(
          'the sandbox error clears only after a successful render',
        );

      // Do not let this test leave the shared cached realm on the deliberately
      // broken server generation. The next acceptance row opens this card in
      // Interact mode, so recovery includes autosave, indexing, and the
      // matching realm acknowledgement—not only the optimistic local render.
      await settled();
      assert
        .dom('[data-test-live-preview]')
        .hasText(
          'VERSION TWO',
          'the repaired preview survives persistence and acknowledgement',
        );
    });
  }

  test('[HMR-06] Reload Card deliberately remounts the selected sandbox preview', async function (assert) {
    let cardId = `${testRealmURL}LivePreview/sample`;

    await visitOperatorMode({
      stacks: [[{ id: cardId, format: 'isolated' }]],
      submode: 'interact',
    });

    await waitFor('[data-test-live-preview]');
    let originalPreview = document.querySelector('[data-test-live-preview]');
    assert.ok(originalPreview, 'the original sandboxed preview rendered');

    await click(
      `[data-test-stack-card="${cardId}"] [data-test-more-options-button]`,
    );
    assert
      .dom('[data-test-boxel-menu-item-text="Reload Card"]')
      .exists('the sandboxed card menu exposes an explicit reload action');
    assert
      .dom('[data-test-boxel-menu-item-text="Execution: Capsule"]')
      .exists('the card menu identifies the effective execution mode');
    assert
      .dom('[data-test-boxel-menu-item-text="Execution: Capsule"]')
      .hasText('Execution: Capsule', 'the temporary status stays concise');
    let menuLabels = Array.from(
      document.querySelectorAll<HTMLElement>(
        '[data-test-boxel-menu-item-text]',
      ),
      (element) => element.dataset.testBoxelMenuItemText,
    );
    assert.deepEqual(
      menuLabels.slice(0, 4),
      [
        'Execution: Capsule',
        'Copy Card URL',
        'Copy as Markdown',
        'Reload Card',
      ],
      'execution status is followed by copy actions and Reload Card',
    );
    assert
      .dom('[data-test-boxel-menu-item-text="Execution: Capsule"]')
      .isDisabled('the execution mode is presented as inert status');
    await click('[data-test-boxel-menu-item-text="Reload Card"]');

    await waitUntil(
      () =>
        document.querySelector('[data-test-live-preview]') !== originalPreview,
    );
    assert
      .dom('[data-test-live-preview]')
      .hasText('VERSION ONE', 'reload uses the current draft source');
    assert.false(
      originalPreview?.isConnected,
      'the old authored component DOM was deliberately remounted',
    );
  });
});
