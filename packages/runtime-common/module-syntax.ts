import generate from '@babel/generator';
import * as Babel from '@babel/core';
import {
  schemaAnalysisPlugin,
  Options,
  type PossibleCardClass,
  type ModuleDeclaration,
  type BaseDeclaration,
} from './schema-analysis-plugin';
import {
  removeFieldPlugin,
  Options as RemoveOptions,
} from './remove-field-plugin';
import { ImportUtil } from 'babel-import-util';
import startCase from 'lodash/startCase';
import camelCase from 'lodash/camelCase';
import upperFirst from 'lodash/upperFirst';
import { parseTemplates } from '@cardstack/ember-template-imports/lib/parse-templates';
import { baseRealm } from './index';
//@ts-ignore unsure where these types live
import decoratorsPlugin from '@babel/plugin-syntax-decorators';
//@ts-ignore unsure where these types live
import classPropertiesPlugin from '@babel/plugin-syntax-class-properties';
//@ts-ignore unsure where these types live
import typescriptPlugin from '@babel/plugin-syntax-typescript';

import type { types as t } from '@babel/core';
import type { NodePath } from '@babel/traverse';
import type { FieldType } from 'https://cardstack.com/base/card-api';

export type { PossibleCardClass, BaseDeclaration };

export class ModuleSyntax {
  declare possibleCards: PossibleCardClass[];
  declare moduleDeclarations: ModuleDeclaration[];
  private declare ast: t.File;

  constructor(src: string) {
    this.analyze(src);
  }

  private analyze(src: string) {
    let moduleAnalysis: Options = {
      possibleCards: [],
      moduleDeclarations: [],
    };
    let preprocessedSrc = preprocessTemplateTags(src);

    let r = Babel.transformSync(preprocessedSrc, {
      code: false,
      ast: true,
      plugins: [
        typescriptPlugin,
        [decoratorsPlugin, { legacy: true }],
        classPropertiesPlugin,
        [schemaAnalysisPlugin, moduleAnalysis],
      ],
    });
    this.ast = r!.ast!;
    this.possibleCards = moduleAnalysis.possibleCards;
    this.moduleDeclarations = moduleAnalysis.moduleDeclarations;
  }

  elements(): ModuleDeclaration[] {
    return this.moduleDeclarations;
  }

  code(): string {
    let preprocessedSrc = generate(this.ast).code;
    return preprocessedSrc.replace(
      /\[templte\(`([^`].*?)`\)\];/gs,
      `<template>$1</template>`,
    );
  }

  addField(
    cardName:
      | { type: 'exportedName'; name: string }
      | { type: 'localName'; name: string },
    fieldName: string,
    fieldRef: { name: string; module: string },
    fieldType: FieldType,
  ) {
    let card = this.getCard(cardName);
    if (card.possibleFields.has(fieldName)) {
      // At this level, we can only see this specific module. we'll need the
      // upstream caller to perform a field existence check on the card
      // definition to ensure this field does not already exist in the adoption chain
      throw new Error(`the field "${fieldName}" already exists`);
    }

    let newField = makeNewField(
      card.path,
      fieldRef,
      fieldType,
      fieldName,
      cardName.name,
    );
    let src = this.code();
    this.analyze(src); // reanalyze to update node start/end positions based on AST mutation

    let insertPosition: number;
    let lastField = [...card.possibleFields.values()].pop();
    if (lastField) {
      lastField = [...this.getCard(cardName).possibleFields.values()].pop()!;
      if (typeof lastField.path.node.end !== 'number') {
        throw new Error(
          `bug: could not determine the string end position to insert the new field`,
        );
      }
      insertPosition = lastField.path.node.end;
    } else {
      let bodyStart = this.getCard(cardName).path.get('body').node.start;
      if (typeof bodyStart !== 'number') {
        throw new Error(
          `bug: could not determine the string end position to insert the new field`,
        );
      }
      insertPosition = bodyStart + 1;
    }

    // we use string manipulation to add the field into the src so that we
    // don't have to suffer babel's decorator transpilation
    src = `
      ${src.substring(0, insertPosition)}
      ${newField}
      ${src.substring(insertPosition)}
    `;
    // analyze one more time to incorporate the new field
    this.analyze(src);
  }

  // Note that we will rely on the fact that the card author first updated the
  // card so that the field is unused in the card's templates or computeds or
  // child cards. Removing a field that is consumed by this card or cards that
  // adopt from this card will cause runtime errors. We'd probably need to rely
  // on card compilation to be able to guard for this scenario
  removeField(
    cardName:
      | { type: 'exportedName'; name: string }
      | { type: 'localName'; name: string },
    fieldName: string,
  ) {
    let card = this.getCard(cardName);
    let field = card.possibleFields.get(fieldName);
    if (!field) {
      throw new Error(`field "${fieldName}" does not exist`);
    }

    this.ast = Babel.transformFromAstSync(this.ast, undefined, {
      code: false,
      ast: true,
      plugins: [
        typescriptPlugin,
        [decoratorsPlugin, { legacy: true }],
        classPropertiesPlugin,
        [removeFieldPlugin, { card, field } as RemoveOptions],
      ],
    })!.ast!;

    this.analyze(this.code());
  }

  private getCard(
    card:
      | { type: 'exportedName'; name: string }
      | { type: 'localName'; name: string },
  ): PossibleCardClass {
    let cardName = card.name;
    let cardClass: PossibleCardClass | undefined;
    if (card.type === 'exportedName') {
      cardClass = this.possibleCards.find((c) => c.exportedAs === cardName);
    } else {
      cardClass = this.possibleCards.find((c) => c.localName === cardName);
    }
    if (!cardClass) {
      throw new Error(
        `cannot find card with ${startCase(
          card.type,
        ).toLowerCase()} of "${cardName}" in module`,
      );
    }
    return cardClass;
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

function makeNewField(
  target: NodePath<t.Node>,
  fieldRef: { name: string; module: string },
  fieldType: FieldType,
  fieldName: string,
  cardName: string,
): string {
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
    cardName === fieldRef.name
  ) {
    // syntax for when a card has a linksTo or linksToMany field to a card with the same type as itself
    return `@${fieldDecorator.name} ${fieldName} = ${fieldTypeIdentifier.name}(() => ${cardName});`;
  }

  let fieldCardIdentifier = importUtil.import(
    target as NodePath<any>,
    fieldRef.module,
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

  return `@${fieldDecorator.name} ${fieldName} = ${fieldTypeIdentifier.name}(() => ${fieldCardIdentifier.name});`;
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
