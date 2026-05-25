// Baseline variant with sourcemaps disabled — answers "how much of
// babel's wall time is sourcemap encoding?" Spoiler: not much.
import { transformAsync } from '@babel/core';
//@ts-ignore — no types
import AmdPlugin from '@babel/plugin-transform-modules-amd';

export const name = 'babel-no-sourcemap';

export async function transform(
  src: string,
  moduleId: string,
): Promise<string> {
  const out = await transformAsync(src, {
    //@ts-ignore — interop with cjs default export
    plugins: [[AmdPlugin.default ?? AmdPlugin, { noInterop: true, moduleId }]],
    sourceMaps: false,
    filename: moduleId,
  });
  return out!.code!;
}
