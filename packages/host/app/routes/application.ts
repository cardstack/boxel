import Route from '@ember/routing/route';
import { service } from '@ember/service';

import ENV from '@cardstack/host/config/environment';

import {
  installTrustedUIGlobals,
  loadCodeMirror,
} from '../lib/trusted-ui-runtime';

import type MonacoService from '../services/monaco-service';

export default class Application extends Route {
  @service declare monacoService: MonacoService;

  private loadMonacoForMarkdown = async () => {
    if (this.isDestroying || this.isDestroyed) {
      return undefined;
    }
    return await this.monacoService.getMonacoContext();
  };

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
    if (typeof window !== 'undefined') {
      // This global function allows the markdown field to asynchronously
      // load monaco context for syntax highlighting.
      (window as any).__loadMonacoForMarkdown = this.loadMonacoForMarkdown;
      installTrustedUIGlobals();
      // Edit mode is a common operator-mode transition. Start fetching the
      // editor after the host globals are installed so a trusted Base field
      // portal does not add a module-network waterfall to that transition.
      void loadCodeMirror();
    }
  }

  willDestroy(): void {
    super.willDestroy?.();
    if (typeof window !== 'undefined') {
      if (
        (window as any).__loadMonacoForMarkdown === this.loadMonacoForMarkdown
      ) {
        delete (window as any).__loadMonacoForMarkdown;
      }
      // The trusted UI loaders are app-lifetime compatibility shims. Do not
      // remove them with a route instance: existing deployed Base modules may
      // still be rendering in a Host-owned field portal during route/HMR work.
    }
  }
}
