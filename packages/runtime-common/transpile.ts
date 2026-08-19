import * as babel from '@babel/core';
//@ts-ignore type import requires a newer Typescript with node16 moduleResolution
import makeEmberTemplatePlugin from 'babel-plugin-ember-template-compilation/browser';
//@ts-ignore breaks esbuild for VS Code extension
import type { Options as EmberTemplatePluginOptions } from 'babel-plugin-ember-template-compilation/src/plugin';
//@ts-ignore breaks esbuild for VS Code extension
import type { ExtendedPluginBuilder } from 'babel-plugin-ember-template-compilation/src/js-utils';
import { loaderPlugin } from './loader-plugin.ts';
//@ts-ignore ironically no types are available
import typescriptPlugin from '@babel/plugin-transform-typescript';
//@ts-ignore no types are available
import emberConcurrencyAsyncPlugin from 'ember-concurrency-async-plugin';
import { generateScopedCSSPlugin } from 'glimmer-scoped-css/ast-transform';

//@ts-ignore no upstream types
import decoratorTransforms from 'decorator-transforms';

//@ts-ignore no upstream types
import * as emberCompiler from 'ember-source/ember-template-compiler/index.js';

import * as ContentTag from 'content-tag';

import { md5 } from 'super-fast-md5';

const scopedCSSTransform = generateScopedCSSPlugin({
  noGlobal: true,
}) as ExtendedPluginBuilder;

// ember-source's defaultId hashes the template source via node's crypto
// module, looked up through `module.require` / `globalThis.require`. Under
// the ESM compiler entry neither is defined, so defaultId falls back to
// `() => null` and the emitted template JSON contains `"id": null`. Wrap
// precompile with a deterministic id derived from super-fast-md5, which
// works identically in node and the browser.
function templateId(src: string) {
  return md5(src).substring(0, 8);
}

const compiler = {
  ...emberCompiler,
  precompile(template: string, options: Record<string, unknown> = {}) {
    return (emberCompiler as { precompile: Function }).precompile(template, {
      ...options,
      id: options.id || templateId,
    });
  },
};

export async function transpileJS(
  content: string,
  debugFilename: string,
): Promise<string> {
  const contentIsAllWhitespace = content.match(/^\s*$/);

  if (contentIsAllWhitespace) {
    return '';
  }

  const processor = new ContentTag.Preprocessor();
  // content-tag surfaces this filename in user-facing "Parse Error at ..."
  // messages. The caller passes an absolute path (e.g. "/broken.gts") so
  // babel's moduleName resolution is deterministic, but for error messages
  // we want the cleaner relative form.
  let contentTagFilename = debugFilename.startsWith('/')
    ? debugFilename.slice(1)
    : debugFilename;
  content = processor.process(content, {
    filename: contentTagFilename,
    inline_source_map: true,
  }).code;

  const templateOptions: EmberTemplatePluginOptions = {
    compiler,
    transforms: [scopedCSSTransform],
  };

  const transformed = await babel.transformAsync(content, {
    filename: debugFilename,
    compact: false, // this helps for readability when debugging
    plugins: [
      emberConcurrencyAsyncPlugin,
      [typescriptPlugin, { allowDeclareFields: true }],
      [decoratorTransforms],
      [makeEmberTemplatePlugin, templateOptions],
      loaderPlugin,
    ],
    highlightCode: false, // Do not output ANSI color codes in error messages so that the client can display them plainly
  });
  const src = transformed?.code;
  if (!src) {
    throw new Error('bug: should never get here');
  }

  return src;
}
