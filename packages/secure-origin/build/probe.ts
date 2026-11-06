// The build probe (`probe.html`) is built as an environment of its own
// (`vite.config.ts`), into `probe/` beneath the build's output, wherever that
// is: `dist/probe/` for `pnpm build`, `dist-lint/probe/` for `pnpm lint:build`.
// The realm server reads only the output's own manifest, which names the
// pages it serves, so it never reads or serves the probe.
import { join } from 'node:path';

import type { Plugin } from 'vite';

export const PROBE_ENVIRONMENT = 'probe';
export const PROBE_DIR = 'probe';

export function probeOutDir(): Plugin {
  return {
    name: 'secure-origin-probe-out-dir',
    apply: 'build',
    config(config) {
      return {
        environments: {
          [PROBE_ENVIRONMENT]: {
            build: {
              outDir: join(config.build?.outDir ?? 'dist', PROBE_DIR),
            },
          },
        },
      };
    },
  };
}

// Where an environment's output sits in the build's output, as the build
// record names its files: the pages' at the top, the probe's in `probe/`.
export function outputPrefix(environment: string): string {
  return environment === PROBE_ENVIRONMENT ? `${PROBE_DIR}/` : '';
}
