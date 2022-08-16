import { transformSync } from "@babel/core";
import * as Babel from "@babel/core";
import {
  schemaAnalysisPlugin,
  Options,
  PossibleCardClass,
  ClassReference,
  ExternalReference,
} from "./schema-analysis-plugin";
import type { CardRef } from "./search-index";

export type { ClassReference, ExternalReference };

import { parseTemplates } from "@cardstack/ember-template-imports/lib/parse-templates";

//@ts-ignore unsure where these types live
import decoratorsPlugin from "@babel/plugin-syntax-decorators";
//@ts-ignore unsure where these types live
import classPropertiesPlugin from "@babel/plugin-syntax-class-properties";
//@ts-ignore unsure where these types live
import typescriptPlugin from "@babel/plugin-syntax-typescript";

export class ModuleSyntax {
  ast: Babel.types.File;
  possibleCards: PossibleCardClass[];

  constructor(private src: string) {
    let moduleAnalysis: Options = { possibleCards: [] };
    let preprocessedSrc = this.preprocessTemplateTags();

    this.ast = transformSync(preprocessedSrc, {
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
        // TODO: it could also be a reexport, in which case we should return a
        // CardRef instead of undefined
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

  private preprocessTemplateTags(): string {
    let output = [];
    let offset = 0;
    let matches = parseTemplates(this.src, "no-filename", "template");
    for (let match of matches) {
      output.push(this.src.slice(offset, match.start.index));
      output.push("[templte(`"); // use back tick so we can be tolerant of newlines
      output.push(
        this.src
          .slice(match.start.index! + match.start[0].length, match.end.index)
          .replace(/`/g, "\\`")
      );
      output.push("`)]        ");
      offset = match.end.index! + match.end[0].length;
    }
    output.push(this.src.slice(offset));
    return output.join("");
  }
}

function assertNever(value: never) {
  return new Error(`should never happen ${value}`);
}
