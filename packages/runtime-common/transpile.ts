import * as babel from '@babel/core';
//@ts-ignore type import requires a newer Typescript with node16 moduleResolution
import makeEmberTemplatePlugin from 'babel-plugin-ember-template-compilation/browser';
//@ts-ignore breaks esbuild for VS Code extension
import type { Options as EmberTemplatePluginOptions } from 'babel-plugin-ember-template-compilation/src/plugin';
//@ts-ignore breaks esbuild for VS Code extension
import type { ExtendedPluginBuilder } from 'babel-plugin-ember-template-compilation/src/js-utils';
import { loaderPlugin } from './loader-plugin';
//@ts-ignore ironically no types are available
import typescriptPlugin from '@babel/plugin-transform-typescript';
//@ts-ignore no types are available
import emberConcurrencyAsyncPlugin from 'ember-concurrency-async-plugin';
import { generateScopedCSSPlugin } from 'glimmer-scoped-css/ast-transform';

//@ts-ignore no upstream types
import decoratorTransforms from 'decorator-transforms';
import { compiler } from './etc';

const scopedCSSTransform = generateScopedCSSPlugin({
  noGlobal: true,
}) as ExtendedPluginBuilder;

export async function transpileJS(
  content: string,
  debugFilename: string,
): Promise<string> {
  const contentIsAllWhitespace = content.match(/^\s*$/);

  if (contentIsAllWhitespace) {
    return '';
  }

  const processor = new ContentTagGlobal.Preprocessor();
  content = processor.process(content, {
    filename: debugFilename,
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
