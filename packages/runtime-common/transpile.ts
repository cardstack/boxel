import { preprocessEmbeddedTemplates } from '@cardstack/ember-template-imports/lib/preprocess-embedded-templates';
import * as babel from '@babel/core';
//@ts-ignore type import requires a newer Typescript with node16 moduleResolution
import makeEmberTemplatePlugin from 'babel-plugin-ember-template-compilation/browser';
import type { Options as EmberTemplatePluginOptions } from 'babel-plugin-ember-template-compilation/src/plugin';
import type { EmberTemplateCompiler } from 'babel-plugin-ember-template-compilation/src/ember-template-compiler';
import type { ExtendedPluginBuilder } from 'babel-plugin-ember-template-compilation/src/js-utils';
//@ts-ignore no types are available
import * as etc from 'ember-source/dist/ember-template-compiler';
import { loaderPlugin } from './loader-plugin';
//@ts-ignore no types are available
import glimmerTemplatePlugin from '@cardstack/ember-template-imports/src/babel-plugin';
//@ts-ignore no types are available
import decoratorsProposalPlugin from '@babel/plugin-proposal-decorators';
//@ts-ignore no types are available
import classPropertiesPlugin from '@babel/plugin-transform-class-properties';
//@ts-ignore ironically no types are available
import typescriptPlugin from '@babel/plugin-transform-typescript';
//@ts-ignore no types are available
import emberConcurrencyAsyncPlugin from 'ember-concurrency-async-plugin';
import scopedCSSTransform from 'glimmer-scoped-css/ast-transform';

export function transpileJS(content: string, debugFilename: string): string {
  let contentIsAllWhitespace = content.match(/^\s*$/);

  if (contentIsAllWhitespace) {
    return '';
  }

  content = preprocessEmbeddedTemplates(content, {
    relativePath: debugFilename,
    getTemplateLocals: etc._GlimmerSyntax.getTemplateLocals,
    templateTag: 'template',
    templateTagReplacement: '__GLIMMER_TEMPLATE',
    includeSourceMaps: true,
    includeTemplateTokens: true,
  }).output;

  let templateOptions: EmberTemplatePluginOptions = {
    compiler: etc as unknown as EmberTemplateCompiler,
    transforms: [scopedCSSTransform as ExtendedPluginBuilder],
  };

  let src = babel.transformSync(content, {
    filename: debugFilename,
    compact: false, // this helps for readability when debugging
    plugins: [
      glimmerTemplatePlugin,
      emberConcurrencyAsyncPlugin,
      [typescriptPlugin, { allowDeclareFields: true }],
      [decoratorsProposalPlugin, { legacy: true }],
      classPropertiesPlugin,
      [makeEmberTemplatePlugin, templateOptions],
      loaderPlugin,
    ],
    highlightCode: false, // Do not output ANSI color codes in error messages so that the client can display them plainly
  })?.code;
  if (!src) {
    throw new Error('bug: should never get here');
  }

  return src;
}
