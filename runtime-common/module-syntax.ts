import generate from "@babel/generator";
import * as Babel from "@babel/core";
import {
  schemaAnalysisPlugin,
  Options,
  PossibleCardClass,
  ClassReference,
  ExternalReference,
} from "./schema-analysis-plugin";
import { ImportUtil } from "babel-import-util";
import startCase from "lodash/startCase";
import camelCase from "lodash/camelCase";
import upperFirst from "lodash/upperFirst";
import { parseTemplates } from "@cardstack/ember-template-imports/lib/parse-templates";
import { baseRealm } from "@cardstack/runtime-common";
//@ts-ignore unsure where these types live
import decoratorsPlugin from "@babel/plugin-syntax-decorators";
//@ts-ignore unsure where these types live
import classPropertiesPlugin from "@babel/plugin-syntax-class-properties";
//@ts-ignore unsure where these types live
import typescriptPlugin from "@babel/plugin-syntax-typescript";

import { types as t } from "@babel/core";
import type { NodePath } from "@babel/traverse";
import type { CardRef, ExportedCardRef } from "./search-index";

export type { ClassReference, ExternalReference };

export class ModuleSyntax {
  declare ast: t.File;
  declare possibleCards: PossibleCardClass[];
  declare reexports: { exportName: string; ref: ExternalReference }[];

  constructor(src: string) {
    this.analyze(src);
  }

  private analyze(src: string) {
    let moduleAnalysis: Options = { possibleCards: [], reexports: [] };
    let preprocessedSrc = preprocessTemplateTags(src);

    this.ast = Babel.transformSync(preprocessedSrc, {
      code: false,
      ast: true,
      plugins: [
        typescriptPlugin,
        [decoratorsPlugin, { legacy: true }],
        classPropertiesPlugin,
        [schemaAnalysisPlugin, moduleAnalysis],
      ],
    })!.ast!;
    this.possibleCards = moduleAnalysis.possibleCards;
    this.reexports = moduleAnalysis.reexports;
  }

  code(): string {
    let preprocessedSrc = generate(this.ast).code;
    return preprocessedSrc.replace(
      /\[templte\(`([^`].*)`\)\];*/g,
      `<template>$1</template>`
    );
  }

  addField(
    cardName:
      | { type: "exportedName"; name: string }
      | { type: "localName"; name: string },
    fieldName: string,
    fieldRef: ExportedCardRef,
    fieldType: "contains" | "containsMany"
  ) {
    let card = this.getCard(cardName);
    let lastField = [...card.possibleFields.values()].pop();
    if (lastField) {
      let path: NodePath | null = lastField.path;
      while (path && path.type !== "Program") {
        path = path.parentPath;
      }
      if (!path) {
        throw new Error(`bug: could not determine program path for module`);
      }
      let programPath = path as NodePath<t.Program>;

      //@ts-ignore ImportUtil doesn't seem to believe our Babel.types is a
      //typeof Babel.types
      let importUtil = new ImportUtil(t, programPath);
      let fieldDecorator = importUtil.import(
        lastField.path as any, // casting to NodePath<t.Node> isn't working
        `${baseRealm.url}card-api`,
        "field"
      );
      let fieldTypeIdentifier = importUtil.import(
        lastField.path as any, // casting to NodePath<t.Node> isn't working
        `${baseRealm.url}card-api`,
        fieldType
      );
      let fieldCardIdentifier = importUtil.import(
        lastField.path as any, // casting to NodePath<t.Node> isn't working
        fieldRef.module,
        fieldRef.name,
        suggestedCardName(fieldRef)
      );

      // reanalyzing the code causes the last field node start and end positions
      // to update based on the AST mutations made above.
      let src = this.code();
      this.analyze(src);
      lastField = [...this.getCard(cardName).possibleFields.values()].pop()!;
      let lastFieldEnd = lastField.path.node.end;
      if (typeof lastFieldEnd !== "number") {
        throw new Error(
          `bug: could not determine the string end position to insert the new field`
        );
      }
      // we use string manipulation to add the field into the src so that we
      // don't have to suffer babel's decorator transpilation
      let fieldSrc = `@${fieldDecorator.name} ${fieldName} = ${fieldTypeIdentifier.name}(${fieldCardIdentifier.name});`;
      src = `${src.substring(0, lastFieldEnd)}\n  ${fieldSrc}\n${src.substring(
        lastFieldEnd
      )}`;

      // analyze one more time to incorporate the new field
      this.analyze(src);
    } else {
      throw new Error("TODO");
    }
  }

  private getCard(
    card:
      | { type: "exportedName"; name: string }
      | { type: "localName"; name: string }
  ): PossibleCardClass {
    let cardName = card.name;
    let cardClass: PossibleCardClass | undefined;
    if (card.type === "exportedName") {
      cardClass = this.possibleCards.find((c) => c.exportedAs === cardName);
    } else {
      cardClass = this.possibleCards.find((c) => c.localName === cardName);
    }
    if (!cardClass) {
      throw new Error(
        `cannot find card with ${startCase(
          card.type
        ).toLowerCase()} of "${cardName}" in module`
      );
    }
    return cardClass;
  }

  // goal: either we find the PossibleCardClass, or we produce a CardRef for a
  // *different* module than us so that progress can be made by following that,
  // or we error because we can see the thing you're asking about is not
  // possibly a card (because it's not class definition).
  find(
    ref: CardRef
  ):
    | { result: "local"; class: PossibleCardClass }
    | { result: "remote"; ref: CardRef }
    | undefined {
    if (ref.type === "exportedCard") {
      let found = this.possibleCards.find((c) => c.exportedAs === ref.name);
      if (!found) {
        let reexport = this.reexports.find((r) => r.exportName === ref.name);
        if (reexport) {
          return {
            result: "remote",
            ref: {
              type: "exportedCard",
              module: reexport.ref.module,
              name: reexport.ref.name,
            },
          };
        }
        return undefined; // the ref we are looking for turns out to not actually be a card
      }
      return { result: "local", class: found };
    } else if (ref.type === "ancestorOf") {
      let parent = this.find(ref.card);
      if (!parent) {
        return undefined; // the ref we are looking for turns out to not actually be a card
      }
      if (parent.result === "remote") {
        // the card whose ancestor they're asking about is not in this module.
        // This would happen due to reexports.
        return {
          result: "remote",
          ref: { type: "ancestorOf", card: parent.ref },
        };
      } else {
        let ancestorRef = parent.class.super;
        if (ancestorRef.type === "internal") {
          return {
            result: "local",
            class: this.possibleCards[ancestorRef.classIndex],
          };
        } else {
          return {
            result: "remote",
            ref: {
              type: "exportedCard",
              module: ancestorRef.module,
              name: ancestorRef.name,
            },
          };
        }
      }
    } else if (ref.type === "fieldOf") {
      let parent = this.find(ref.card);
      if (!parent) {
        return undefined; // the ref we are looking for turns out to not actually be a card
      }
      if (parent.result === "remote") {
        // the card whose field they're asking about is not in this module. This
        // would happen due to reexports.
        return {
          result: "remote",
          ref: { type: "fieldOf", field: ref.field, card: parent.ref },
        };
      } else {
        let field = parent.class.possibleFields.get(ref.field);
        if (!field) {
          throw new Error(`no such field ${ref.field}`);
        }
        if (field.card.type === "internal") {
          return {
            result: "local",
            class: this.possibleCards[field.card.classIndex],
          };
        } else {
          return {
            result: "remote",
            ref: {
              type: "exportedCard",
              module: field.card.module,
              name: field.card.name,
            },
          };
        }
      }
    }
    throw assertNever(ref);
  }
}

function preprocessTemplateTags(src: string): string {
  let output = [];
  let offset = 0;
  let matches = parseTemplates(src, "no-filename", "template");
  for (let match of matches) {
    output.push(src.slice(offset, match.start.index));
    output.push("[templte(`"); // use back tick so we can be tolerant of newlines
    output.push(
      src
        .slice(match.start.index! + match.start[0].length, match.end.index)
        .replace(/`/g, "\\`")
    );
    output.push("`)]        ");
    offset = match.end.index! + match.end[0].length;
  }
  output.push(src.slice(offset));
  return output.join("");
}

function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}

function suggestedCardName(ref: ExportedCardRef): string {
  if (ref.name.toLowerCase().endsWith("card")) {
    return ref.name;
  }
  let name = ref.name;
  if (name === "default") {
    name = ref.module.split("/").pop()!;
  }
  return upperFirst(camelCase(`${name} card`));
}
