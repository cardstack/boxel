import { transformSync } from '@babel/core';
import * as Babel from '@babel/core';
import {
  schemaAnalysisPlugin,
  Options,
  PossibleCardClass,
} from './schema-analysis-plugin';
//@ts-ignore unsure where these types live
import decoratorsPlugin from '@babel/plugin-syntax-decorators';
//@ts-ignore unsure where these types live
import classPropertiesPlugin from '@babel/plugin-syntax-class-properties';
//@ts-ignore unsure where these types live
import typescriptPlugin from '@babel/plugin-transform-typescript';

// represents the cards within an entire javascript module
export class CardDefinitions {
  private ast: Babel.types.File;
  private possibleCards: PossibleCardClass[];

  static async create(
    src: string,
    inspector: CardInspector
  ): Promise<CardDefinitions> {
    let definitions = new CardDefinitions(src, inspector);
    await definitions.semanticPhase();
    return definitions;
  }

  private constructor(private src: string, private inspector: CardInspector) {
    // construct handles the synchronous syntactic phase
    let moduleAnalysis: Options = { possibleCards: [] };
    this.ast = transformSync(this.src, {
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

  // the semantic phase is async
  private async semanticPhase() {
    for (let card of this.possibleCards) {
      if (await this.isCard(card)) {
        this.cards.push(new CardDefinition());
      }
    }
  }

  private async isCard(possibleCard: PossibleCardClass): Promise<boolean> {
    switch (possibleCard.super.type) {
      case 'external': {
        let mod = await this.inspector.resolveModule(possibleCard.super.module);
        let superClass = mod[possibleCard.super.name];
        return typeof superClass === 'function' && 'baseCard' in superClass;
      }
      case 'internal':
        return await this.isCard(
          this.possibleCards[possibleCard.super.classIndex]
        );
      default:
        throw assertNever(possibleCard.super);
    }
  }

  cards: CardDefinition[] = [];
}

export class CardDefinition {
  getField(_name: string): FieldDefinition {
    throw new Error('unimp');
  }
}

export interface FieldDefinition {
  module: string;
  moduleExportedName: string;
}

export class CardInspector {
  readonly resolveModule: (specifier: string) => Promise<Record<string, any>>;

  constructor(params: {
    resolveModule: (specifier: string) => Promise<Record<string, any>>;
  }) {
    this.resolveModule = params.resolveModule;
  }

  async inspectCards(src: string): Promise<CardDefinitions> {
    return await CardDefinitions.create(src, this);
  }
}

function assertNever(value: never) {
  throw new Error(`should never happen ${value}`);
}
