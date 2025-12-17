import Route from '@ember/routing/route';
import { service } from '@ember/service';

import ENV from '@cardstack/host/config/environment';

import type MonacoService from '../services/monaco-service';

export default class Application extends Route {
  @service declare monacoService: MonacoService;

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
      (window as any).__loadMonacoForMarkdown ??= async () => {
        let monacoContext = await this.monacoService.getMonacoContext();
        return monacoContext;
      };
    }
  }
}
