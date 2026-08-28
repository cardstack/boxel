import Route from '@ember/routing/route';

import config from '@cardstack/host/config/environment';

export interface BoxelExecutionPreviewModel {
  cardURL: string;
}

/**
 * Narrow staging-backed proof route for the document-first execution entry.
 * The route carries only a URL; the renderer fetches the inert JSON:API
 * document and chooses Direct or Sandbox before card materialization.
 */
export default class BoxelExecutionPreviewRoute extends Route {
  model({ cardPath }: { cardPath: string }): BoxelExecutionPreviewModel {
    return {
      cardURL: new URL(cardPath, config.realmServerURL).href,
    };
  }
}
