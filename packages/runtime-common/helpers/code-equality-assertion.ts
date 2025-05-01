import { transform } from '@babel/core';
import { NodePath } from '@babel/traverse';
import { StringLiteral } from '@babel/types';
import { createPatch } from 'diff';
import { isNode } from '../index';
//@ts-ignore unsure where these types live
import decoratorsPlugin from '@babel/plugin-syntax-decorators';
//@ts-ignore unsure where these types live
import classPropertiesPlugin from '@babel/plugin-syntax-class-properties';
//@ts-ignore unsure where these types live
import typescriptPlugin from '@babel/plugin-syntax-typescript';

import * as QUnit from 'qunit';

declare global {
  interface Assert {
    codeEqual: typeof codeEqual;
  }
}

QUnit.assert.codeEqual = codeEqual;

function standardizePlugin() {
  const visitor = {
    // all string literals switch to double quotes
    StringLiteral(path: NodePath<StringLiteral & { extra: { raw: string } }>) {
      path.node.extra = Object.assign({}, path.node.extra);
      path.node.extra.raw = `"${path.node.extra.raw.slice(1, -1)}"`;
      path.replaceWith(path.node);
    },
  };
  return { visitor };
}

function standardize(code: string) {
  code = preprocessTemplateTags(code);
  return transform(code, {
    plugins: [
      typescriptPlugin,
      [decoratorsPlugin, { legacy: true }],
      classPropertiesPlugin,
      standardizePlugin,
    ],
  })!.code;
}

function preprocessTemplateTags(code: string): string {
  let output = [];
  let offset = 0;
  let matches = new ContentTagGlobal.Preprocessor().parse(code);
  for (let match of matches) {
    output.push(code.slice(offset, match.range.start));
    // its super important that this not be the template function we use in the
    // module-syntax (templte), so that we can ensure that we are not
    // inadvertantly comparing precompiled source against an actual template.
    // rather we want to make sure we compare templates to templates (an apples
    // to apples comparison).
    output.push('[template(`');
    output.push(match.contents.replace(/`/g, '\\`'));
    output.push('`)]');
    offset = match.range.end;
  }
  output.push(code.slice(offset));
  return output.join('');
}

function codeEqual(
  this: Assert,
  actual: string,
  expected: string,
  message = 'code should be equal',
) {
  let parsedActual = standardize(actual)!;
  let parsedExpected = standardize(expected)!;

  let result = parsedActual === parsedExpected;
  let msg: string;
  if (!result) {
    msg = message;
    if (isNode) {
      msg = `${message}
${createPatch('', parsedExpected, parsedActual)
  .split('\n')
  .slice(4)
  .join('\n')}`;
    }
  } else {
    msg = message;
  }
  (this as any).pushResult({
    result,
    actual,
    expected,
    message: msg,
  });
}
