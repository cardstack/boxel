import { RenderingTestContext, settled } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';
import { Realm } from '@cardstack/runtime-common/realm';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
} from '../helpers';
import {
  setupBaseRealm,
  createFromSerialized,
  ensureLinksLoaded,
  field,
  contains,
  linksTo,
  CardDef,
  FieldDef,
  Component,
  StringField,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';
let loader: Loader;
let _testRealm: Realm;

module('Integration | field configuration', function (hooks) {
  setupRenderingTest(hooks);
  // Initialize base realm helpers so createFromSerialized/ensureLinksLoaded
  // use the test loader bound to this environment.
  setupBaseRealm(hooks);

  hooks.beforeEach(function () {
    loader = getService('loader-service').loader;
  });

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  setupCardLogs(
    hooks,
    async () => await loader.import(`${baseRealm.url}card-api`),
  );
  hooks.beforeEach(async function (this: RenderingTestContext) {
    class ColorField extends FieldDef {
      static displayName = 'Color';
      // FieldDef-level default configuration (function form)
      static configuration = (_self: any) => ({
        presentation: { palette: ['blue', 'green'] },
      });

      static edit = class Edit extends Component<typeof this> {
        get firstColor() {
          return this.args.configuration?.presentation?.palette?.[0];
        }
        get hasRed() {
          return this.firstColor === 'red';
        }
        get hasBlue() {
          return this.firstColor === 'blue';
        }
        <template>
          <span data-test-has-red>{{if this.hasRed 'yes' 'no'}}</span>
          <span data-test-has-blue>{{if this.hasBlue 'yes' 'no'}}</span>
        </template>
      };
    }

    class ParentCard extends CardDef {
      static displayName = 'Parent';
      @field title = contains(StringField);
      @field color = contains(ColorField, {
        configuration: {
          presentation: {
            palette: ['red'],
          },
        },
      });

      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-parent>
            <@fields.color @format='edit' />
          </div>
        </template>
      };
    }

    class ReactiveColorField extends FieldDef {
      static displayName = 'ReactiveColor';
      static edit = class Edit extends Component<typeof this> {
        get color() {
          return this.args.configuration?.presentation?.palette;
        }
        get hasPurple() {
          return this.color === 'purple';
        }
        <template>
          <span data-test-has-purple>{{if this.hasPurple 'yes' 'no'}}</span>
        </template>
      };
    }

    class ThemeCard extends CardDef {
      @field palette = contains(StringField);
    }

    class ParentReactive extends CardDef {
      @field theme = linksTo(ThemeCard);
      @field color = contains(ReactiveColorField, {
        configuration: (self) => ({
          presentation: { palette: self.theme?.palette },
        }),
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-reactive-parent>
            <@fields.color @format='edit' />
          </div>
        </template>
      };
    }

    let setup = await setupIntegrationTestRealm({
      mockMatrixUtils,
      contents: {
        'parent.gts': { ParentCard },
        'reactive.gts': { ParentReactive, ThemeCard, ReactiveColorField },
        'ParentCard/instance.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}ParentCard/instance`,
            attributes: {
              title: 'test parent',
              color: {},
            },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}parent`,
                name: 'ParentCard',
              },
            },
          },
        },
        'ThemeCard/main.json': {
          data: {
            type: 'card',
            id: `${testRealmURL}ThemeCard/main`,
            attributes: { palette: 'purple' },
            meta: {
              adoptsFrom: {
                module: `${testRealmURL}reactive`,
                name: 'ThemeCard',
              },
            },
          },
        },
      },
    });
    _testRealm = setup.realm;
  });

  test('merged configuration is injected into field format component', async function (assert) {
    // import the card class and create a local instance for rendering
    let mod = await loader.import(`${testRealmURL}parent`);
    let ParentCard = (mod as any).ParentCard;
    let card = new ParentCard({ title: 'local parent' });
    await renderCard(loader, card, 'isolated');

    assert
      .dom('[data-test-parent] [data-test-has-red]')
      .hasText('yes', 'per-usage config overrides and is present');
    assert
      .dom('[data-test-parent] [data-test-has-blue]')
      .hasText('no', 'arrays are replaced, not concatenated');
  });

  test('configuration reacts when a linked relationship loads', async function (assert) {
    // Create a ParentReactive instance that links to ThemeCard/main but does not include it
    let resource = {
      attributes: { color: {}, title: 'parent' },
      relationships: {
        theme: { links: { self: `${testRealmURL}ThemeCard/main` } },
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}reactive`,
          name: 'ParentReactive',
        },
      },
    };

    // Provide a custom store that can satisfy link resolution from cache, avoiding HTTP fetch.
    let themeRef = `${testRealmURL}ThemeCard/main`;
    let mod = await loader.import(`${testRealmURL}reactive`);
    let ThemeCard = (mod as any).ThemeCard;
    let cachedTheme = new ThemeCard({ palette: 'purple' });
    let themeAvailable = false;
    let customStore = {
      get(url: string) {
        if (url.replace(/\.json$/, '') === themeRef && themeAvailable) {
          return cachedTheme;
        }
        return undefined;
      },
      set() {},
      setNonTracked() {},
      makeTracked() {},
      async loadDocument(_url: string) {
        throw new Error('should not fetch');
      },
      trackLoad() {},
      async loaded() {},
    } as any;

    let parent = await createFromSerialized(
      resource as any,
      { data: resource } as any,
      undefined,
      { store: customStore },
    );

    // Render: configuration should be undefined initially (NotLoaded), so has-purple is 'no'
    await renderCard(loader, parent, 'isolated');
    assert
      .dom('[data-test-reactive-parent] [data-test-has-purple]')
      .hasText('no', 'configuration is unavailable before theme loads');

    // No write needed since the custom store returns the Theme from cache
    // Now load links and assert re-render picks up the theme palette
    themeAvailable = true;
    await ensureLinksLoaded(parent);
    await settled();
    assert
      .dom('[data-test-reactive-parent] [data-test-has-purple]')
      .hasText('yes', 'configuration updates after link loads');
  });

  test('configuration reacts when a consumed linked card field value changes', async function (assert) {
    // Create a ParentReactive instance that links to ThemeCard/main using a cached Theme instance
    let resource = {
      attributes: { color: {}, title: 'parent' },
      relationships: {
        theme: { links: { self: `${testRealmURL}ThemeCard/main` } },
      },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}reactive`,
          name: 'ParentReactive',
        },
      },
    };

    // Custom store returns a Theme instance immediately so initial configuration resolves
    let themeRef = `${testRealmURL}ThemeCard/main`;
    let mod = await loader.import(`${testRealmURL}reactive`);
    let ThemeCard = (mod as any).ThemeCard;
    let cachedTheme = new ThemeCard({ palette: 'purple' });
    let customStore = {
      get(url: string) {
        return url.replace(/\\.json$/, '') === themeRef
          ? cachedTheme
          : undefined;
      },
      set() {},
      setNonTracked() {},
      makeTracked() {},
      async loadDocument(_url: string) {
        throw new Error('should not fetch');
      },
      trackLoad() {},
      async loaded() {},
    } as any;

    let parent = await createFromSerialized(
      resource as any,
      { data: resource } as any,
      undefined,
      { store: customStore },
    );

    // Ensure link is realized, then render and verify initial state 'yes'
    await ensureLinksLoaded(parent);
    await settled();
    await renderCard(loader, parent, 'isolated');
    assert
      .dom('[data-test-reactive-parent] [data-test-has-purple]')
      .hasText('yes', 'configuration reflects initial theme value');

    // Change the consumed field in the linked Theme card
    cachedTheme.palette = 'orange';
    // Trigger parent recompute and re-render
    await ensureLinksLoaded(parent);
    await settled();

    assert
      .dom('[data-test-reactive-parent] [data-test-has-purple]')
      .hasText('no', 'configuration updates when consumed field changes');
  });

  test('configuration reacts when a parent attribute changes', async function (assert) {
    class LocalReactiveColorField extends FieldDef {
      static displayName = 'LocalReactiveColor';
      static edit = class Edit extends Component<typeof this> {
        get color() {
          return this.args.configuration?.presentation?.palette;
        }
        get hasPurple() {
          return this.color === 'purple';
        }
        <template>
          <span data-test-has-purple>{{if this.hasPurple 'yes' 'no'}}</span>
        </template>
      };
    }

    class ParentSelfReactive extends CardDef {
      @field preferredColor = contains(StringField);
      @field color = contains(LocalReactiveColorField, {
        configuration: (self) => ({
          presentation: { palette: self.preferredColor },
        }),
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-reactive-parent-self>
            <@fields.color @format='edit' />
          </div>
        </template>
      };
    }

    let parent = new ParentSelfReactive({ preferredColor: 'purple' });

    await renderCard(loader, parent, 'isolated');
    assert
      .dom('[data-test-reactive-parent-self] [data-test-has-purple]')
      .hasText('yes', 'configuration reflects initial parent field value');

    parent.preferredColor = 'orange';
    await settled();
    assert
      .dom('[data-test-reactive-parent-self] [data-test-has-purple]')
      .hasText('no', 'configuration updates when parent field changes');
  });
});
