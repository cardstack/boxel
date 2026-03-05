import { getService } from '@universal-ember/test-support';

import { CardContextName } from '@cardstack/runtime-common';

import PrerenderedCardSearch from '@cardstack/host/components/prerendered-card-search';
import { getCardCollection } from '@cardstack/host/resources/card-collection';
import { getCard } from '@cardstack/host/resources/card-resource';

import {
  catalogRealm,
  provideConsumeContext,
  setupIntegrationTestRealm,
  setupLocalIndexing,
  setupRealmCacheTeardown,
  testRealmURL,
  withCachedRealmSetup,
} from '../../helpers';
import { setupBaseRealm } from '../../helpers/base-realm';
import { setupMockMatrix } from '../../helpers/mock-matrix';
import { setupRenderingTest } from '../../helpers/setup';

type SetupOptions = {
  beforeEach?: (this: any) => Promise<void> | void;
  setupRealm?: 'auto' | 'manual';
};

export function setupCatalogIsolatedCardTest(
  hooks: NestedHooks,
  options?: SetupOptions,
) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);
  setupLocalIndexing(hooks);

  let activeRealms = [
    testRealmURL,
    ...(catalogRealm ? [catalogRealm.url] : []),
  ];
  let mockMatrixUtils = setupMockMatrix(hooks, {
    loggedInAs: '@testuser:localhost',
    activeRealms,
    autostart: true,
  });
  setupRealmCacheTeardown(hooks, 'catalog-isolated');

  hooks.beforeEach(async function (this: any) {
    this.loader = getService('loader-service').loader;
    this.store = getService('store');
    this.commandContext = getService('command-service').commandContext;
    this.catalogRealm = catalogRealm as any;
    this.testRealmURL = testRealmURL;
    this.catalogTestRealmContents = {};
    this.setupCatalogRealm = async (contents: any, cacheKey?: string) =>
      withCachedRealmSetup(cacheKey ?? 'catalog-isolated', async () =>
        setupIntegrationTestRealm({
          mockMatrixUtils,
          realmURL: testRealmURL,
          contents,
        }),
      );

    provideConsumeContext(CardContextName, {
      commandContext: this.commandContext,
      prerenderedCardSearchComponent: PrerenderedCardSearch,
      getCard: getCard as any,
      getCards: (this.store as any).getSearchResource.bind(this.store),
      getCardCollection: getCardCollection as any,
      store: this.store,
      mode: 'host',
      submode: 'host',
    } as any);

    if (options?.beforeEach) {
      await options.beforeEach.call(this);
    }

    if (options?.setupRealm !== 'manual') {
      await this.setupCatalogRealm(this.catalogTestRealmContents);
    }
  });
}
