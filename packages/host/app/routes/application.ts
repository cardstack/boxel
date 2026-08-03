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
      // Lazy-load KaTeX for math rendering in markdown content.
      // The base package's markdown template calls this via globalThis.
      (globalThis as any).__loadKatex ??= async () => {
        let mod = await import('katex');
        return mod.default;
      };
      // Lazy-load Mermaid.js for diagram rendering in markdown content.
      // The base package's markdown template calls this via globalThis.
      (globalThis as any).__loadMermaid ??= async () => {
        let mod = await import('mermaid');
        return mod.default;
      };
      // Lazy-load CodeMirror for WYSIWYG editing in RichMarkdownField.
      // The base package's CodeMirrorEditor component calls this via globalThis.
      let codeMirrorContextPromise:
        | Promise<typeof import('@cardstack/host/lib/codemirror-context')>
        | undefined;
      (globalThis as any).__loadCodeMirror ??= async () => {
        codeMirrorContextPromise ??=
          // @ts-expect-error dynamic import resolved by Ember's build pipeline
          import('@cardstack/host/lib/codemirror-context');
        return (await codeMirrorContextPromise).default;
      };
      // Edit mode is a common operator-mode transition. Start fetching the
      // editor after the host globals are installed so a trusted Base field
      // portal does not add a module-network waterfall to that transition.
      void (globalThis as any).__loadCodeMirror();
    }
  }

  willDestroy(): void {
    super.willDestroy?.();
    if (typeof globalThis !== 'undefined') {
      delete (globalThis as any).__loadMonacoForMarkdown;
      delete (globalThis as any).__loadKatex;
      delete (globalThis as any).__loadMermaid;
      delete (globalThis as any).__loadCodeMirror;
    }
  }
}
