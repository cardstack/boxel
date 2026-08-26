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

const templateOptions: EmberTemplatePluginOptions = Object.freeze({
  compiler,
  transforms: Object.freeze([
    scopedCSSTransform,
  ]) as (typeof scopedCSSTransform)[],
});

// The realm's TypeScript entry, named on its own because which imports survive
// to runtime is a fact other code has to agree with: the source classifier
// reads a module's import graph off the parsed statements and has to reach the
// same answer this erasure does. Code checking that agreement uses this value,
// so it cannot be checking against a restatement that has drifted.
export const realmTypescriptPlugin: babel.PluginItem = Object.freeze([
  typescriptPlugin,
  Object.freeze({ allowDeclareFields: true }),
]) as babel.PluginItem;

// The Babel half of the realm's pipeline. Which JavaScript syntax survives
// transpilation is a property of this array: a Babel plugin can widen the
// parser only through `manipulateOptions`, so driving Babel over these plugins
// reports the accept-set the Babel stage admits. content-tag's preprocessor
// runs ahead of it with an accept-set of its own, so this is the second of two
// gates rather than the only one — and Babel additionally merges any config
// file it finds from the working directory, which a caller transpiling inside
// someone else's project can move.
//
// The Boxel source classifier in `packages/host` parses card source with a
// hand-written mirror of these contributions, and a mirror that falls behind
// reads servable modules as unfinished drafts. It holds itself to this array
// rather than to a restatement of it, so adding a plugin here that contributes
// syntax fails that comparison instead of passing silently.
//
// One array and one options object serve every transpile, which is also what
// lets Babel instantiate each plugin once for the life of the process instead
// of per module. They are frozen because a plugin instance shared that widely
// must not be reachable for mutation; nothing writes to them today
// (`babel-plugin-ember-template-compilation` normalizes its options into a
// fresh object and never writes back).
export const realmBabelPlugins: readonly babel.PluginItem[] = Object.freeze([
  emberConcurrencyAsyncPlugin,
  realmTypescriptPlugin,
  [decoratorTransforms],
  [makeEmberTemplatePlugin, templateOptions],
  loaderPlugin,
] as babel.PluginItem[]);

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

  const transformed = await babel.transformAsync(content, {
    filename: debugFilename,
    compact: false, // this helps for readability when debugging
    // Cast rather than spread: Babel caches instantiated plugins against the
    // identity of the array it is handed, so a fresh copy per call would build
    // five plugin instances per module.
    plugins: realmBabelPlugins as babel.PluginItem[],
    highlightCode: false, // Do not output ANSI color codes in error messages so that the client can display them plainly
  });
  const src = transformed?.code;
  if (!src) {
    throw new Error('bug: should never get here');
  }

  return src;
}
