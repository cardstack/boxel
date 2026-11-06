// The part of ember-template-lint's Node API that `build/pret-ui-lint.ts`
// uses. The package ships no types.
declare module 'ember-template-lint' {
  interface LintResult {
    rule: string;
    message: string;
    line: number;
    column: number;
  }
  export default class TemplateLinter {
    constructor(options: { workingDir?: string; config?: object });
    verify(options: {
      source: string;
      filePath: string;
    }): Promise<LintResult[]>;
  }
}
