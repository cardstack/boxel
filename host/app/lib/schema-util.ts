import { transformSync } from '@babel/core';
import * as Babel from '@babel/core';
import { schemaAnalysisPlugin, Options } from './schema-analysis-plugin';
//@ts-ignore unsure where these types live
import decoratorsPlugin from '@babel/plugin-syntax-decorators';
//@ts-ignore unsure where these types live
import classPropertiesPlugin from '@babel/plugin-syntax-class-properties';
//@ts-ignore unsure where these types live
import typescriptPlugin from '@babel/plugin-transform-typescript';

// represents the cards within an entire javascript module
export class CardDefinitions {
  private ast: Babel.types.File;

  constructor(src: string) {
    let moduleAnalysis: Options = { imports: {}, exports: {}, classes: {} };
    this.ast = transformSync(src, {
      code: false,
      ast: true,
      plugins: [
        typescriptPlugin,
        [decoratorsPlugin, { legacy: true }],
        classPropertiesPlugin,
        [schemaAnalysisPlugin, moduleAnalysis],
      ],
    })!.ast!;

    // Use the moduleAnalysis to work out the exported cards from this module.
    // Once approach could be to start at the imports, and look specifically for the
    // import specifier for the `import { Card } from 'runtime-spike/lib/card-api'`,
    // then trace through all the classes that extend from that specifier--these will
    // be the cards. Then determine which cards are exported, and wht the exported names
    // are.

    // question: should we only look at classes that directly extend from the base Card class?
    debugger;
  }

  getCard(_name: string): CardDefinition {
    throw new Error('unimplemented');
  }
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
