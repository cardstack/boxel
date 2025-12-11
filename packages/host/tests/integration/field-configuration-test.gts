import { settled } from '@ember/test-helpers';
import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import { baseRealm, Deferred } from '@cardstack/runtime-common';
import type { SingleCardDocument } from '@cardstack/runtime-common';
import { Loader } from '@cardstack/runtime-common/loader';

import type {
  CardStore,
  CardDef as CardDefType,
} from 'https://cardstack.com/base/card-api';

import {
  testRealmURL,
  setupCardLogs,
  setupLocalIndexing,
  setupIntegrationTestRealm,
  setupSnapshotRealm,
} from '../helpers';
import {
  createFromSerialized,
  field,
  contains,
  linksTo,
  linksToMany,
  CardDef,
  FieldDef,
  Component,
  StringField,
} from '../helpers/base-realm';
import { setupMockMatrix } from '../helpers/mock-matrix';
import { renderCard } from '../helpers/render-component';
import { setupRenderingTest } from '../helpers/setup';
let loader: Loader;

class DeferredLinkStore implements CardStore {
  private instances = new Map<string, CardDefType>();
  private readyDocs = new Map<string, SingleCardDocument>();
  private pendingDocs = new Map<string, Deferred<SingleCardDocument>>();
  private inFlightLoads = new Set<Promise<unknown>>();
  private loadGeneration = 0;

  get(url: string) {
    return this.instances.get(this.normalize(url));
  }

  set(url: string, instance: CardDefType) {
    this.instances.set(this.normalize(url), instance);
  }

  setNonTracked(url: string, instance: CardDefType) {
    this.instances.set(this.normalize(url), instance);
  }

  makeTracked(_id: string) {}

  async loadDocument(url: string) {
    let normalized = this.normalize(url);
    let ready = this.readyDocs.get(normalized);
    if (ready) {
      return ready;
    }
    let pending = this.pendingDocs.get(normalized);
    if (!pending) {
      pending = new Deferred<SingleCardDocument>();
      this.pendingDocs.set(normalized, pending);
    }
    return pending.promise;
  }

  trackLoad(load: Promise<unknown>) {
    if (this.inFlightLoads.has(load)) {
      return;
    }
    this.inFlightLoads.add(load);
    this.loadGeneration++;
    load.finally(() => {
      this.inFlightLoads.delete(load);
    });
  }

  async loaded() {
    let observedGeneration = this.loadGeneration;
    let settled = false;
    while (!settled) {
      if (this.inFlightLoads.size === 0) {
        await Promise.resolve();
      } else {
        await Promise.allSettled(Array.from(this.inFlightLoads));
      }
      if (
        this.inFlightLoads.size === 0 &&
        this.loadGeneration === observedGeneration
      ) {
        settled = true;
      } else {
        observedGeneration = this.loadGeneration;
      }
    }
  }

  provideDocument(url: string, doc: SingleCardDocument) {
    let normalized = this.normalize(url);
    this.readyDocs.set(normalized, doc);
    let pending = this.pendingDocs.get(normalized);
    if (pending) {
      pending.fulfill(doc);
      this.pendingDocs.delete(normalized);
    }
  }

  private normalize(url: string) {
    return url.replace(/\.json$/, '');
  }
}

function buildThemeDocument(palette: string): SingleCardDocument {
  return {
    data: {
      type: 'card',
      id: `${testRealmURL}ThemeCard/main`,
      attributes: { palette },
      meta: {
        adoptsFrom: {
          module: `${testRealmURL}reactive`,
          name: 'ThemeCard',
        },
      },
    },
  };
}

module('Integration | field configuration', function (hooks) {
  setupRenderingTest(hooks);

  setupLocalIndexing(hooks);
  let mockMatrixUtils = setupMockMatrix(hooks);

  let snapshot = setupSnapshotRealm<{ loader: Loader }>(hooks, {
    mockMatrixUtils,
    async build({ loader }) {
      let loaderService = getService('loader-service');
      loaderService.loader = loader;
      return { loader };
    },
  });

  setupCardLogs(
    hooks,
    async () => await snapshot.get().loader.import(`${baseRealm.url}card-api`),
  );
  hooks.beforeEach(async function () {
    ({ loader } = snapshot.get());
    class ColorField extends FieldDef {
      static displayName = 'Color';
      // FieldDef-level default configuration (function form)
      static configuration = function (this: any) {
        return { presentation: { palette: ['blue', 'green'] } };
      };

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
        configuration: function (this: ParentReactive) {
          return { presentation: { palette: this.theme?.palette } };
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-reactive-parent>
            <@fields.color @format='edit' />
          </div>
        </template>
      };
    }

    await setupIntegrationTestRealm({
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
    let customStore = new DeferredLinkStore();

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
    customStore.provideDocument(themeRef, buildThemeDocument('purple'));
    await customStore.loaded();
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

    // Custom store resolves the theme document immediately so initial configuration resolves
    let themeRef = `${testRealmURL}ThemeCard/main`;
    let customStore = new DeferredLinkStore();
    customStore.provideDocument(themeRef, buildThemeDocument('purple'));

    let parent = await createFromSerialized(
      resource as any,
      { data: resource } as any,
      undefined,
      { store: customStore },
    );

    // Ensure link is realized, then render and verify initial state 'yes'
    await renderCard(loader, parent, 'isolated');
    await customStore.loaded();
    await settled();
    assert
      .dom('[data-test-reactive-parent] [data-test-has-purple]')
      .hasText('yes', 'configuration reflects initial theme value');

    // Change the consumed field in the linked Theme card
    let mod = await loader.import(`${testRealmURL}reactive`);
    let ThemeCard = (mod as any).ThemeCard;
    let loadedTheme = customStore.get(themeRef) as InstanceType<
      typeof ThemeCard
    >;
    loadedTheme.palette = 'orange';
    (parent as any).theme = loadedTheme;
    // Trigger parent recompute and re-render
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
        configuration: function (this: ParentSelfReactive) {
          return { presentation: { palette: this.preferredColor } };
        },
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

  test('linksTo field passes configuration to embedded card formats', async function (assert) {
    class InnerCard extends CardDef {
      static displayName = 'Inner';
      static embedded = class Embedded extends Component<typeof this> {
        get tag() {
          return (this.args.configuration as any)?.presentation?.tag;
        }
        <template>
          <span data-test-inner-config>{{this.tag}}</span>
        </template>
      };
      static fitted = InnerCard.embedded;
      static atom = InnerCard.embedded;
    }

    class ParentWithLink extends CardDef {
      @field title = contains(StringField);
      @field child = linksTo(InnerCard, {
        configuration: { presentation: { tag: 'from-linksTo' } },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-parent-links-to>
            <@fields.child />
          </div>
        </template>
      };
    }

    let inner = new InnerCard({});
    let parent = new ParentWithLink({ title: 't', child: inner });
    await renderCard(loader, parent, 'isolated');

    assert
      .dom('[data-test-parent-links-to] [data-test-inner-config]')
      .hasText(
        'from-linksTo',
        'embedded card receives configuration from linksTo field',
      );
  });

  test('linksToMany field passes configuration to embedded card formats', async function (assert) {
    class InnerCardMany extends CardDef {
      static displayName = 'InnerMany';
      static embedded = class Embedded extends Component<typeof this> {
        get tag() {
          return (this.args.configuration as any)?.presentation?.tag;
        }
        <template>
          <span data-test-inner-many-config>{{this.tag}}</span>
        </template>
      };
      static fitted = InnerCardMany.embedded;
      static atom = InnerCardMany.embedded;
    }

    class ParentWithLinksMany extends CardDef {
      @field title = contains(StringField);
      @field children = linksToMany(InnerCardMany, {
        configuration: { presentation: { tag: 'from-linksToMany' } },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-parent-links-to-many>
            <@fields.children />
          </div>
        </template>
      };
    }

    let child1 = new InnerCardMany({});
    let child2 = new InnerCardMany({});
    let parent = new ParentWithLinksMany({
      title: 't',
      children: [child1, child2],
    });
    await renderCard(loader, parent, 'isolated');

    assert
      .dom('[data-test-parent-links-to-many] [data-test-inner-many-config]')
      .exists({ count: 2 }, 'renders two embedded cards from linksToMany');
    assert
      .dom('[data-test-parent-links-to-many] [data-test-inner-many-config]')
      .hasText(
        'from-linksToMany',
        'embedded cards receive configuration from linksToMany field',
      );
  });

  test('merges CardDef-level configuration with linksTo per-usage configuration', async function (assert) {
    class InnerCardWithConfig extends CardDef {
      static displayName = 'InnerWithConfig';
      // Provide CardDef-level configuration that the field resolver will pick up
      static configuration = (_self: any) => ({
        presentation: { tag: 'from-carddef', extra: 'keep-me' },
      });
      static embedded = class Embedded extends Component<typeof this> {
        get tag() {
          return (this.args.configuration as any)?.presentation?.tag;
        }
        get extra() {
          return (this.args.configuration as any)?.presentation?.extra;
        }
        get other() {
          return (this.args.configuration as any)?.presentation?.other;
        }
        <template>
          <span data-test-merged-tag>{{this.tag}}</span>
          <span data-test-merged-extra>{{this.extra}}</span>
          <span data-test-merged-other>{{this.other}}</span>
        </template>
      };
      static fitted = InnerCardWithConfig.embedded;
      static atom = InnerCardWithConfig.embedded;
    }

    class ParentWithMergedLink extends CardDef {
      @field title = contains(StringField);
      @field child = linksTo(InnerCardWithConfig, {
        configuration: {
          presentation: { tag: 'from-linksTo', other: 'present' },
        },
      });
      static isolated = class Isolated extends Component<typeof this> {
        <template>
          <div data-test-parent-merged>
            <@fields.child />
          </div>
        </template>
      };
    }

    let inner = new InnerCardWithConfig({});
    let parent = new ParentWithMergedLink({ title: 't', child: inner });
    await renderCard(loader, parent, 'isolated');

    // tag should be overridden by per-usage config
    assert
      .dom('[data-test-parent-merged] [data-test-merged-tag]')
      .hasText(
        'from-linksTo',
        'per-usage configuration overrides CardDef configuration for overlapping keys',
      );
    // extra should be preserved from CardDef configuration due to shallow merge
    assert
      .dom('[data-test-parent-merged] [data-test-merged-extra]')
      .hasText(
        'keep-me',
        'non-overlapping keys from CardDef configuration are preserved',
      );
    // other should be present from per-usage configuration
    assert
      .dom('[data-test-parent-merged] [data-test-merged-other]')
      .hasText(
        'present',
        'non-overlapping keys from per-usage configuration are included',
      );
  });
});
