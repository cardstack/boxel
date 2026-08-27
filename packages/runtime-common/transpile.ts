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
    // Which JavaScript syntax a realm serves is a property of the plugin list
    // below and of content-tag's preprocessor, and of nothing else. Under Node,
    // Babel otherwise merges any `babel.config.*` it finds at the working
    // directory and any `.babelrc` above the file being compiled, so a caller
    // transpiling inside someone else's project — `boxel test`, which serves a
    // user's own `.gts`/`.ts` from that project's root — would inherit that
    // project's Babel configuration and serve syntax on its say-so. An ambient
    // `parserOpts.plugins` entry is enough to admit syntax nothing else in the
    // system can read.
    //
    // That matters beyond the realm: the Host's module classifier reads served
    // source through a front end of its own, and source it cannot read is
    // reported as an unfinished draft — a result whose module graph is empty,
    // which is the fetch authority a sandboxed render is given. Syntax admitted
    // by a config file the classifier never sees therefore costs a card its
    // modules, not merely a slower path.
    //
    // The trade this makes is that a CLI user's own Babel configuration does
    // not reach card source the CLI transpiles. Card source is compiled by the
    // realm's pipeline wherever it is served, and a project-local configuration
    // would make it compile differently in one of those places.
    //
    // The browser build resolves Babel's config-file layer to a stub, so these
    // two flags are what the browser already does, stated where every caller
    // gets it.
    configFile: false,
    babelrc: false,
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
