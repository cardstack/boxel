import { transformSync } from '@babel/core';
import * as Babel from '@babel/core';
import { schemaAnalysisPlugin } from './schema-analysis-plugin';

// represents the cards within an entire javascript module
export class CardDefinitions {
  private ast: Babel.types.File;

  constructor(src: string) {
    this.ast = transformSync(src, {
      code: false,
      ast: true,
      plugins: [schemaAnalysisPlugin],
    })!.ast!;
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
