export interface LintArgs {
  source: string;
}

export interface LintResult {
  output: string;
}

export async function lintFix({ source }: LintArgs): Promise<LintResult> {
  return { output: source };
}
