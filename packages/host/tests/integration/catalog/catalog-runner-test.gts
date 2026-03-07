import { module, test } from 'qunit';

import { renderCard } from '../../helpers/render-component';

import runnerModule from './generated/test-module';
import { setupCatalogIsolatedCardTest } from './setup';

module('Integration | Catalog | runner', function (hooks) {
  setupCatalogIsolatedCardTest(hooks, { setupRealm: 'manual' });

  for (let caseDefinition of (runnerModule.cases ?? []) as any[]) {
    test(caseDefinition.id, async function (this: any, assert) {
      console.info(`[catalog-runner] START ${caseDefinition.id}`);

      let seed =
        typeof caseDefinition.seed === 'function'
          ? await caseDefinition.seed(this)
          : (caseDefinition.seed ?? {});
      await this.setupCatalogRealm(
        seed,
        `catalog-isolated:${caseDefinition.id}`,
      );

      let cardURL =
        typeof caseDefinition.cardURL === 'function'
          ? await caseDefinition.cardURL(this)
          : caseDefinition.cardURL;
      let format = caseDefinition.format ?? 'isolated';
      let card = await this.store.get(cardURL);
      await renderCard(this.loader, card as any, format);

      if (typeof caseDefinition.test !== 'function') {
        throw new Error(
          `Case "${caseDefinition.id}" is missing an async test(ctx, assert) function`,
        );
      }

      await caseDefinition.test(this, assert);

      console.info(`[catalog-runner] PASS ${caseDefinition.id}`);
    });
  }
});
