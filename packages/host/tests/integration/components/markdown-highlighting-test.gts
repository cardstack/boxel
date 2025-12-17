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
    TokenizationRegistry: { getOrCreate: (id: string) => Promise<void> };
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

module('Integration | markdown highlighting', function (hooks) {
  setupRenderingTest(hooks);
  setupBaseRealm(hooks);

  let loader: Loader;
  let originalLoader: unknown;

  hooks.beforeEach(function (this: RenderingTestContext) {
    loader = getService('loader-service').loader;
    originalLoader = (window as any).__loadMonacoForMarkdown;
    (window as any).__loadMonacoForMarkdown = async () => createMonacoStub();
  });

  hooks.afterEach(function () {
    (window as any).__loadMonacoForMarkdown = originalLoader;
  });

  test('renders highlighted tokens for supported languages and plain text for unsupported', async function (assert) {
    class Doc extends CardDef {
      @field body = contains(MarkdownField);
    }

    let doc = new Doc({
      body: [
        '```typescript',
        'const x: number = 1;',
        '```',
        '',
        '```foobar',
        'const y = 2;',
        '```',
        '',
        '```',
        'const z = 3;',
        '```',
      ].join('\n'),
    });

    await renderCard(loader, doc, 'isolated');

    await waitFor('pre[data-code-language="typescript"]');

    assert
      .dom('pre[data-code-language="typescript"] span.mtk2')
      .exists('typescript code uses language-specific token spans');
    assert
      .dom('pre[data-code-language="foobar"] span.mtk1')
      .exists('unsupported language uses plaintext token spans');
    assert
      .dom('pre[data-code-language=""] span.mtk1')
      .exists('unspecified language uses plaintext token spans');
  });
});
