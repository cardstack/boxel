// Baseline: babel + the npm `@babel/plugin-transform-modules-amd`.
//
// NOTE: this candidate is for benchmarking only and is intentionally NOT
// used by the production loader. It also has a known limitation — the npm
// version of `@babel/plugin-transform-modules-amd` does not rewrite
// `import.meta` (the vendored `transform-modules-amd-plugin` did). That's
// fine for a wall-time bench against `transpileAmd` but means evaluating
// this candidate's output via `new Function` will throw on any source
// that uses `import.meta`.
import { transformAsync } from '@babel/core';
//@ts-ignore — no types
import AmdPlugin from '@babel/plugin-transform-modules-amd';

export const name = 'babel-current';

export async function transform(
  src: string,
  moduleId: string,
): Promise<string> {
  const out = await transformAsync(src, {
    //@ts-ignore — interop with cjs default export
    plugins: [[AmdPlugin.default ?? AmdPlugin, { noInterop: true, moduleId }]],
    sourceMaps: 'inline',
    filename: moduleId,
  });
  return out!.code!;
}
