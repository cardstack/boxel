import type { RenderingTestContext } from '@ember/test-helpers';
import { waitFor } from '@ember/test-helpers';

import { getService } from '@universal-ember/test-support';
import { module, test } from 'qunit';

import type { Loader } from '@cardstack/runtime-common';

import {
  CardDef,
  contains,
  field,
  MarkdownField,
  setupBaseRealm,
} from '../../helpers/base-realm';
import { renderCard } from '../../helpers/render-component';
import { setupRenderingTest } from '../../helpers/setup';

type MonacoStub = {
  Uri: { parse: (value: string) => { toString: () => string } };
  languages: {
    getLanguages: () => {
      id: string;
      aliases?: string[];
      loader: () => Promise<void>;
    }[];
    getEncodedLanguageId: (id: string) => number;
    onLanguage: (id: string, cb: () => void) => { dispose: () => void };
    TokenizationRegistry: {
      getOrCreate: (id: string) => Promise<void>;
      get: (id: string | number) => unknown;
    };
    typescript?: {
      getTypeScriptWorker?: () => Promise<(uri: unknown) => Promise<unknown>>;
      getJavaScriptWorker?: () => Promise<(uri: unknown) => Promise<unknown>>;
    };
  };
  editor: {
    createModel: (
      code: string,
      language?: string,
    ) => {
      _lines: string[];
      _language: string;
      getLineCount: () => number;
      dispose: () => void;
    };
    colorizeModelLine: (
      model: { _lines: string[]; _language: string },
      lineNumber: number,
    ) => string;
    colorize: () => Promise<string>;
  };
};

function createMonacoStub(): MonacoStub {
  let supportedLanguages = new Set(['typescript']);

  return {
    Uri: {
      parse(value: string) {
        return {
          toString() {
            return value;
          },
        };
      },
    },
    languages: {
      getLanguages() {
        return [
          {
            id: 'typescript',
            aliases: ['ts'],
            loader: async () => {},
          },
        ];
      },
      getEncodedLanguageId(id: string) {
        return supportedLanguages.has(id.toLowerCase()) ? 1 : 0;
      },
      onLanguage(id: string, cb: () => void) {
        if (supportedLanguages.has(id.toLowerCase())) {
          cb();
        }
        return {
          dispose() {},
        };
      },
      TokenizationRegistry: {
        async getOrCreate(_id: string) {},
        get() {
          return undefined;
        },
      },
      typescript: {
        async getTypeScriptWorker() {
          return async () => ({});
        },
        async getJavaScriptWorker() {
          return async () => ({});
        },
      },
    },
    editor: {
      createModel(code: string, language = '') {
        let lines = code.split('\n');
        return {
          _lines: lines,
          _language: language,
          getLineCount() {
            return lines.length;
          },
          dispose() {},
        };
      },
      colorizeModelLine(model, lineNumber) {
        let line = model._lines[lineNumber - 1] ?? '';
        let isKnown = supportedLanguages.has(model._language.toLowerCase());
        let tokenClass = isKnown ? 'mtk2' : 'mtk1';
        return `<span class="${tokenClass}">${line}</span>`;
      },
      async colorize() {
        return '';
      },
    },
  };
}

module('Integration | markdown highlighting error scenarios', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let originalLoader: unknown;

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    originalLoader = (window as any).__loadMonacoForMarkdown;
  });

  hooks.afterEach(function () {
    (window as any).__loadMonacoForMarkdown = originalLoader;
  });

  test('handles undefined __loadMonacoForMarkdown gracefully', async function (assert) {
    class Doc extends CardDef {
      @field body = contains(MarkdownField);
    }

    let doc = new Doc({
      body: ['```typescript', 'const x = 1;', '```'].join('\n'),
    });

    delete (window as any).__loadMonacoForMarkdown;

    await renderCard(loader, doc, 'isolated');

    assert.dom('.markdown-content').exists('container renders without Monaco');
    assert
      .dom('pre[data-code-language="typescript"]')
      .doesNotExist('code blocks are hidden when Monaco is unavailable');
  });

  test('handles Monaco load returning an unusable editor', async function (assert) {
    class Doc extends CardDef {
      @field body = contains(MarkdownField);
    }

    let doc = new Doc({
      body: ['```typescript', 'const x = 1;', '```'].join('\n'),
    });

    (window as any).__loadMonacoForMarkdown = async () => {
      let stub = createMonacoStub();
      stub.editor.colorizeModelLine = undefined as any;
      return stub;
    };

    await renderCard(loader, doc, 'isolated');
    await waitFor('pre[data-code-language="typescript"]');

    assert
      .dom('pre[data-code-language="typescript"]')
      .exists('pre element renders when Monaco editor is unusable');
  });

  test('handles missing languages.getLanguages method', async function (assert) {
    class Doc extends CardDef {
      @field body = contains(MarkdownField);
    }

    let doc = new Doc({
      body: ['```typescript', 'const x = 1;', '```'].join('\n'),
    });

    (window as any).__loadMonacoForMarkdown = async () => {
      let stub = createMonacoStub();
      stub.languages.getLanguages = () => [];
      return stub;
    };

    await renderCard(loader, doc, 'isolated');

    assert
      .dom('pre[data-code-language="typescript"]')
      .exists('pre element renders with empty languages');
  });

  test('handles missing onLanguage callback', async function (assert) {
    class Doc extends CardDef {
      @field body = contains(MarkdownField);
    }

    let doc = new Doc({
      body: ['```typescript', 'const x = 1;', '```'].join('\n'),
    });

    (window as any).__loadMonacoForMarkdown = async () => {
      let stub = createMonacoStub();
      stub.languages.onLanguage = () => {
        throw new Error('onLanguage failed');
      };
      return stub;
    };

    await renderCard(loader, doc, 'isolated');
    await waitFor('pre[data-code-language="typescript"]');

    assert
      .dom('pre[data-code-language="typescript"]')
      .exists('pre element renders despite onLanguage failure');
  });

  test('handles TokenizationRegistry.getOrCreate failure', async function (assert) {
    class Doc extends CardDef {
      @field body = contains(MarkdownField);
    }

    let doc = new Doc({
      body: ['```typescript', 'const x = 1;', '```'].join('\n'),
    });

    (window as any).__loadMonacoForMarkdown = async () => {
      let stub = createMonacoStub();
      stub.languages.TokenizationRegistry.getOrCreate = async () => {
        throw new Error('Tokenization failed');
      };
      return stub;
    };

    await renderCard(loader, doc, 'isolated');
    await waitFor('pre[data-code-language="typescript"]');

    assert
      .dom('pre[data-code-language="typescript"]')
      .exists('pre element renders despite tokenization failure');
  });

  test('handles colorizeModelLine throwing error', async function (assert) {
    class Doc extends CardDef {
      @field body = contains(MarkdownField);
    }

    let doc = new Doc({
      body: ['```typescript', 'const x = 1;', '```'].join('\n'),
    });

    (window as any).__loadMonacoForMarkdown = async () => {
      let stub = createMonacoStub();
      stub.editor.colorizeModelLine = () => {
        throw new Error('Colorization failed');
      };
      return stub;
    };

    await renderCard(loader, doc, 'isolated');
    await waitFor('pre[data-code-language="typescript"]');

    assert
      .dom('pre[data-code-language="typescript"]')
      .exists('pre element renders despite colorization failure');
  });

  test('handles missing editor.createModel method', async function (assert) {
    class Doc extends CardDef {
      @field body = contains(MarkdownField);
    }

    let doc = new Doc({
      body: ['```typescript', 'const x = 1;', '```'].join('\n'),
    });

    (window as any).__loadMonacoForMarkdown = async () => {
      let stub = createMonacoStub();
      stub.editor.createModel = undefined as any;
      return stub;
    };

    await renderCard(loader, doc, 'isolated');
    await waitFor('pre[data-code-language="typescript"]');

    assert
      .dom('pre[data-code-language="typescript"]')
      .exists('pre element renders with missing createModel');
  });
});
