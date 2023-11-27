import * as Babel from '@babel/core';
import { parse as babelParse } from '@babel/parser';
import { parse, print } from 'recast';
import {
  schemaAnalysisPlugin,
  type Options,
  type PossibleCardOrFieldClass,
  type Declaration,
  type BaseDeclaration,
  type ClassReference,
  isPossibleCardOrFieldClass,
  isInternalReference,
} from './schema-analysis-plugin';
import {
  removeFieldPlugin,
  Options as RemoveOptions,
} from './remove-field-plugin';
import { ImportUtil } from 'babel-import-util';
import camelCase from 'lodash/camelCase';
import upperFirst from 'lodash/upperFirst';
import isEqual from 'lodash/isEqual';
import { parseTemplates } from '@cardstack/ember-template-imports/lib/parse-templates';
import {
  baseRealm,
  maybeRelativeURL,
  trimExecutableExtension,
  codeRefWithAbsoluteURL,
  type CodeRef,
} from './index';
//@ts-ignore unsure where these types live
import decoratorsPlugin from '@babel/plugin-syntax-decorators';
//@ts-ignore unsure where these types live
import classPropertiesPlugin from '@babel/plugin-syntax-class-properties';
//@ts-ignore unsure where these types live
import typescriptPlugin from '@babel/plugin-syntax-typescript';

import { getBabelOptions } from './babel-options';

import type { types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';
import type { FieldType } from 'https://cardstack.com/base/card-api';

export type { PossibleCardOrFieldClass, Declaration, BaseDeclaration };
export { isPossibleCardOrFieldClass, isInternalReference };

export class ModuleSyntax {
  declare possibleCardsOrFields: PossibleCardOrFieldClass[];
  declare declarations: Declaration[];
  private declare ast: t.File;
  private url: URL;

  constructor(src: string, url: URL) {
    this.url = trimExecutableExtension(url);
    this.analyze(src);
  }

  private analyze(src: string) {
    let moduleAnalysis: Options = {
      possibleCardsOrFields: [],
      declarations: [],
    };
    let preprocessedSrc = preprocessTemplateTags(src);

    let ast: Babel.types.Node = parse(preprocessedSrc, {
      parser: {
        parse(source: string) {
          const options =
            getBabelOptions(/*optionally pass in option overrides*/);
          return babelParse(source, options);
        },
      },
    });

    let r = Babel.transformFromAstSync(ast, preprocessedSrc, {
      code: false,
      ast: true,
      cloneInputAst: false,
      plugins: [
        typescriptPlugin,
        [decoratorsPlugin, { legacy: true }],
        classPropertiesPlugin,
        [schemaAnalysisPlugin, moduleAnalysis],
      ],
    });
    this.ast = r!.ast!;
    this.possibleCardsOrFields = moduleAnalysis.possibleCardsOrFields;
    this.declarations = moduleAnalysis.declarations;
  }

  code(): string {
    let preprocessedSrc: string = print(this.ast).code;
    return preprocessedSrc.replace(
      /\[templte\(`([^`].*?)`\)\]/gs,
      `<template>$1</template>`,
    );
  }

  // A note about incomingRelativeTo and outgoingRelativeTo - path parameters in input (e.g. field module path) and output (e.g. field import path) are
  // relative to some path, and we use these parameters to determine what that path is so that the emitted code has correct relative paths.
  addField({
    cardBeingModified,
    fieldName,
    fieldRef,
    fieldType,
    incomingRelativeTo,
    outgoingRelativeTo,
    outgoingRealmURL,
    addFieldAtIndex,
  }: {
    cardBeingModified: CodeRef;
    fieldName: string;
    fieldRef: { name: string; module: string }; // module could be a relative path
    fieldType: FieldType;
    incomingRelativeTo: URL | undefined; // can be undefined when you know the url is not going to be relative
    outgoingRelativeTo: URL | undefined; // can be undefined when you know url is not going to be relative
    outgoingRealmURL: URL | undefined; // should be provided when the other 2 params are provided
    addFieldAtIndex?: number; // if provided, the field will be added at the specified index in the card's possibleFields map
  }) {
    let card = this.getCard(cardBeingModified);
    if (card.possibleFields.has(fieldName)) {
      // At this level, we can only see this specific module. we'll need the
      // upstream caller to perform a field existence check on the card
      // definition to ensure this field does not already exist in the adoption chain
      throw new Error(`the field "${fieldName}" already exists`);
    }

    let newField = makeNewField({
      target: card.path,
      fieldRef,
      fieldType,
      fieldName,
      cardBeingModified,
      incomingRelativeTo,
      outgoingRelativeTo,
      outgoingRealmURL,
      moduleURL: this.url,
    });

    let src = this.code();
    this.analyze(src); // reanalyze to update node start/end positions based on AST mutation
    card = this.getCard(cardBeingModified); // re-get the card to get the updated node positions

    let insertPosition: number;
    if (
      addFieldAtIndex !== undefined &&
      addFieldAtIndex < card.possibleFields.size
    ) {
      let field = Array.from(card.possibleFields.entries())[addFieldAtIndex][1];
      ({ insertPosition, indentedField: newField } = insertFieldBeforePath(
        newField,
        field.path,
        src,
      ));
    } else {
      let lastField = [...card.possibleFields.values()].pop();
      if (lastField) {
        lastField = [...card.possibleFields.values()].pop()!;
        ({ insertPosition, indentedField: newField } = insertFieldAfterPath(
          newField,
          lastField.path,
          src,
        ));
      } else {
        // calculate the position and indent based on an existing class member
        // and barring that use the class body with an indentation of 2 spaces
        let body = card.path.get('body');
        let [classMember] = body.get('body');
        if (classMember) {
          ({ insertPosition, indentedField: newField } = insertFieldBeforePath(
            newField,
            classMember,
            src,
          ));
        } else {
          if (typeof body.node.start !== 'number') {
            throw new Error(
              `bug: could not determine the string start position of the class body to insert the new field`,
            );
          }
          if (typeof body.node.end !== 'number') {
            throw new Error(
              `bug: could not determine the string start position of the class body to insert the new field`,
            );
          }
          let startOfLine =
            src.substring(0, body.node.start).lastIndexOf('\n') + 1;
          let indent = src.substring(startOfLine).search(/\S/); // location of first non-whitespace char
          insertPosition =
            src.substring(0, body.node.end).lastIndexOf('\n') + 1;
          if (insertPosition < body.node.start + 1) {
            // need to manufacture new lines
            insertPosition = body.node.end - 1;
            newField = `\n${' '.repeat(indent + 2)}${newField}\n${' '.repeat(
              indent,
            )}`;
          } else {
            newField = `${' '.repeat(indent + 2)}${newField}\n`;
          }
        }
      }
    }

    // we use string manipulation to add the field into the src so that we
    // don't have to suffer babel's decorator transpilation
    src = `
      ${src.substring(0, insertPosition)}${newField}${src.substring(
        insertPosition,
      )}
    `;
    // analyze one more time to incorporate the new field
    this.analyze(src);
  }

  // Note that we will rely on the fact that the card author first updated the
  // card so that the field is unused in the card's templates or computeds or
  // child cards. Removing a field that is consumed by this card or cards that
  // adopt from this card will cause runtime errors. We'd probably need to rely
  // on card compilation to be able to guard for this scenario
  removeField(cardBeingModified: CodeRef, fieldName: string) {
    let card = this.getCard(cardBeingModified);
    let field = card.possibleFields.get(fieldName);
    if (!field) {
      throw new Error(`field "${fieldName}" does not exist`);
    }

    let fieldIndex = Array.from(card.possibleFields.entries())
      .map((f) => f[0])
      .indexOf(fieldName);

    // we need to re-parse the AST with recast before we transform it again so
    // that we don't lose the decorations that recast performs on the AST in
    // order to track Node provenance. basically every babel transform needs to
    // be fed an AST from a recast parse
    let preprocessedSrc = preprocessTemplateTags(this.code());
    let ast: Babel.types.Node = parse(preprocessedSrc, {
      parser: {
        parse(source: string) {
          const options =
            getBabelOptions(/*optionally pass in option overrides*/);
          return babelParse(source, options);
        },
      },
    });

    this.ast = Babel.transformFromAstSync(ast, undefined, {
      code: false,
      ast: true,
      cloneInputAst: false,
      plugins: [
        typescriptPlugin,
        [decoratorsPlugin, { legacy: true }],
        classPropertiesPlugin,
        [removeFieldPlugin, { card, field } as RemoveOptions],
      ],
    })!.ast!;

    this.analyze(this.code());

    return fieldIndex; // Useful for re-adding a new field in the same position (i.e editing a field, which is composed of removeField and addField)
  }

  // This function performs the same job as
  // @cardstack/runtime-common/code-ref.ts#loadCard() but using syntax instead
  // of running code
  private getCard(codeRef: CodeRef): PossibleCardOrFieldClass {
    let cardOrFieldClass: PossibleCardOrFieldClass | undefined;
    if (!('type' in codeRef)) {
      cardOrFieldClass = this.possibleCardsOrFields.find(
        (c) => c.exportedAs === codeRef.name,
      );
    } else if (codeRef.type === 'ancestorOf') {
      let classRef = this.getCard(codeRef.card).super;
      if (!classRef) {
        throw new Error(
          `Could not determine the ancestor of ${JSON.stringify(
            codeRef,
          )} in module ${this.url.href}`,
        );
      }
      cardOrFieldClass = this.getPossibleCardForClassReference(classRef);
    } else if (codeRef.type === 'fieldOf') {
      let parentCard = this.getCard(codeRef.card);
      let field = parentCard.possibleFields.get(codeRef.field);
      if (!field) {
        throw new Error(
          `interior card ${JSON.stringify(codeRef)} has no field '${
            codeRef.field
          }' in module ${this.url.href}`,
        );
      }
      cardOrFieldClass = this.getPossibleCardForClassReference(field.card);
    }
    if (!cardOrFieldClass) {
      throw new Error(
        `cannot find card ${JSON.stringify(codeRef)} in module ${
          this.url.href
        }`,
      );
    }
    return cardOrFieldClass;
  }

  private getPossibleCardForClassReference(
    classRef: ClassReference,
  ): PossibleCardOrFieldClass | undefined {
    if (classRef.type === 'external') {
      if (
        trimExecutableExtension(new URL(classRef.module, this.url)) === this.url
      ) {
        return this.possibleCardsOrFields.find(
          (c) => c.exportedAs === classRef.name,
        );
      }
      throw new Error(
        `Don't know how to resolve external class reference ${JSON.stringify(
          classRef,
        )} into a card/field. Module syntax only has knowledge of this particular module ${
          this.url.href
        }.`,
      );
    } else {
      if (classRef.classIndex == null) {
        throw new Error(
          `Cannot resolve class reference with undefined 'classIndex' when looking up interior card/field in module ${this.url.href}`,
        );
      }
      return this.possibleCardsOrFields[classRef.classIndex];
    }
  }
}

function preprocessTemplateTags(src: string): string {
  let output = [];
  let offset = 0;
  let matches = parseTemplates(src, 'no-filename', 'template');
  for (let match of matches) {
    output.push(src.slice(offset, match.start.index));
    // we are using this name as well as padded spaces at the end so that source
    // maps are unaffected
    output.push('[templte(`');
    output.push(
      src
        .slice(match.start.index! + match.start[0].length, match.end.index)
        .replace(/`/g, '\\`'),
    );
    output.push('`)]        ');
    offset = match.end.index! + match.end[0].length;
  }
  output.push(src.slice(offset));
  return output.join('');
}

function makeNewField({
  target,
  fieldRef,
  fieldType,
  fieldName,
  cardBeingModified,
  incomingRelativeTo,
  outgoingRelativeTo,
  outgoingRealmURL,
  moduleURL,
}: {
  target: NodePath<t.Node>;
  fieldRef: { name: string; module: string };
  fieldType: FieldType;
  fieldName: string;
  cardBeingModified: CodeRef;
  incomingRelativeTo: URL | undefined;
  outgoingRelativeTo: URL | undefined;
  outgoingRealmURL: URL | undefined;
  moduleURL: URL;
}): string {
  let programPath = getProgramPath(target);
  //@ts-ignore ImportUtil doesn't seem to believe our Babel.types is a
  //typeof Babel.types
  let importUtil = new ImportUtil(Babel.types, programPath);
  let fieldDecorator = importUtil.import(
    // there is some type of mismatch here--importUtil expects the
    // target.parentPath to be non-nullable, but unable to express that in types
    target as NodePath<any>,
    `${baseRealm.url}card-api`,
    'field',
  );
  let fieldTypeIdentifier = importUtil.import(
    target as NodePath<any>,
    `${baseRealm.url}card-api`,
    fieldType,
  );

  if (
    (fieldType === 'linksTo' || fieldType === 'linksToMany') &&
    isEqual(
      codeRefWithAbsoluteURL(fieldRef, moduleURL, {
        trimExecutableExtension: true,
      }),
      codeRefWithAbsoluteURL(cardBeingModified, moduleURL, {
        trimExecutableExtension: true,
      }),
    )
  ) {
    // syntax for when a card has a linksTo or linksToMany field to a card with the same type as itself
    return `@${fieldDecorator.name} ${fieldName} = ${fieldTypeIdentifier.name}(() => ${fieldRef.name});`;
  }

  let relativeFieldModuleRef;
  if (incomingRelativeTo && outgoingRelativeTo) {
    relativeFieldModuleRef = maybeRelativeURL(
      new URL(fieldRef.module, incomingRelativeTo),
      outgoingRelativeTo,
      outgoingRealmURL,
    );
  } else {
    relativeFieldModuleRef = fieldRef.module;
  }

  let fieldCardIdentifier = importUtil.import(
    target as NodePath<any>,
    relativeFieldModuleRef,
    fieldRef.name,
    suggestedCardName(fieldRef),
  );

  if (
    fieldRef.module.startsWith(baseRealm.url) &&
    fieldRef.name === 'default'
  ) {
    // primitive fields
    return `@${fieldDecorator.name} ${fieldName} = ${fieldTypeIdentifier.name}(${fieldCardIdentifier.name});`;
  }

  return `@${fieldDecorator.name} ${fieldName} = ${fieldTypeIdentifier.name}(${fieldCardIdentifier.name});`;
}

function getProgramPath(path: NodePath<any>): NodePath<t.Program> {
  let currentPath: NodePath | null = path;
  while (currentPath && currentPath.type !== 'Program') {
    currentPath = currentPath.parentPath;
  }
  if (!currentPath) {
    throw new Error(`bug: could not determine program path for module`);
  }
  return currentPath as NodePath<t.Program>;
}

function suggestedCardName(ref: { name: string; module: string }): string {
  if (ref.name.toLowerCase().endsWith('card')) {
    return ref.name;
  }
  let name = ref.name;
  if (name === 'default') {
    name = ref.module.split('/').pop()!;
  }
  return upperFirst(camelCase(`${name} card`));
}

function insertFieldBeforePath(
  field: string,
  path: NodePath,
  src: string,
): { insertPosition: number; indentedField: string } {
  if (typeof path.node.start !== 'number') {
    throw new Error(
      `bug: could not determine the string start position of the class member prior to the new field`,
    );
  }
  let startOfLine = src.substring(0, path.node.start).lastIndexOf('\n');
  let insertPosition = startOfLine + 1; // add new field before the existing field
  let indent = path.node.start - startOfLine - 1;
  let indentedField = `${' '.repeat(indent)}${field}\n`;
  return { insertPosition, indentedField };
}

function insertFieldAfterPath(
  field: string,
  path: NodePath,
  src: string,
): { insertPosition: number; indentedField: string } {
  if (typeof path.node.start !== 'number') {
    throw new Error(
      `bug: could not determine the string start position of the field prior to the new field`,
    );
  }
  if (typeof path.node.end !== 'number') {
    throw new Error(
      `bug: could not determine the string end position to the field prior to the new field`,
    );
  }
  let insertPosition = src.indexOf('\n', path.node.end);
  let indent =
    path.node.start - src.substring(0, path.node.start).lastIndexOf('\n') - 1;
  let indentedField = `\n${' '.repeat(indent)}${field}`;
  return { insertPosition, indentedField };
}
