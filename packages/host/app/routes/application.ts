import Route from '@ember/routing/route';
import { schedule } from '@ember/runloop';
import { service } from '@ember/service';

import ENV from '@cardstack/host/config/environment';

import type MonacoService from '../services/monaco-service';

export default class Application extends Route {
  @service declare monacoService: MonacoService;

  activate(): void {
    super.activate();
    schedule('afterRender', () => {
      document.body.classList.add('boxel-ready');
    });
  }

  async beforeModel(transition: any): Promise<void> {
    // Override the matrix URL for testing
    if (ENV.environment === 'test' || ENV.environment === 'development') {
      if (transition.to?.queryParams.matrixURL) {
        ENV.matrixURL = transition.to.queryParams.matrixURL;
        console.log(
          'Matrix URL has been modified for testing to: ',
          ENV.matrixURL,
        );
      }
    }
    if (typeof globalThis !== 'undefined') {
      // This global function allows the markdown field to asynchronously
      // load monaco context for syntax highlighting.
      let route = this;
      (globalThis as any).__loadMonacoForMarkdown ??= async () => {
        if (route.isDestroying || route.isDestroyed) {
          return undefined;
        }
        return await route.monacoService.getMonacoContext();
      };
    }
  }

  willDestroy(): void {
    super.willDestroy?.();
    if (typeof globalThis !== 'undefined') {
      delete (globalThis as any).__loadMonacoForMarkdown;
    }
  }
}
