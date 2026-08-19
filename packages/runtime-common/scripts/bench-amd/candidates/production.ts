// The production transpiler — `transpileAmd` from `amd-transpile.ts`.
// This is what `Loader.fetchModule` calls. Comparing this candidate's
// wall time to `babel-current` is the headline number on the PR.
import { transpileAmd } from '../../../amd-transpile/index.ts';

export const name = 'production';

export async function transform(
  src: string,
  moduleId: string,
): Promise<string> {
  return transpileAmd(src, { moduleId });
}
