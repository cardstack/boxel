import { type FastBootInstance } from './fastboot-from-deployed';
import { instantiateFastBoot } from './fastboot-from-deployed';
import {
  type IndexRunner,
  type RunnerOpts,
} from '@cardstack/runtime-common/worker';
import { JSDOM } from 'jsdom';
import { type ErrorReporter } from '@cardstack/runtime-common/realm';
import { performance } from 'perf_hooks';
import { readFileSync } from 'fs-extra';
import { join } from 'path';
import * as ContentTagGlobal from 'content-tag';

(globalThis as any).ContentTagGlobal = ContentTagGlobal;

const appName = '@cardstack/host';
export async function makeFastBootIndexRunner(
  dist: URL,
  getRunnerOpts: (optsId: number) => RunnerOpts,
): Promise<{ getRunner: IndexRunner; getIndexHTML: () => Promise<string> }> {
  let fastboot: FastBootInstance;
  let distPath: string;

  let globalWithErrorReporter = global as typeof globalThis & {
    __boxelErrorReporter: ErrorReporter;
  };

  ({ fastboot, distPath } = await instantiateFastBoot(
    appName,
    dist,
    (defaultGlobals: any) => {
      return Object.assign({}, defaultGlobals, {
        __boxelErrorReporter: globalWithErrorReporter.__boxelErrorReporter,
        URL: globalThis.URL,
        Request: globalThis.Request,
        Response: globalThis.Response,
        ContentTagGlobal,
        btoa,
        atob,
        performance,
        getRunnerOpts,
        _logDefinitions: (globalThis as any)._logDefinitions,
        jsdom: new JSDOM(''),
      });
    },
  ));

  return {
    getRunner: async (optsId: number) => {
      await fastboot.visit(`/indexer/${optsId}`, {
        // TODO we'll need to configure this host origin as part of the hosted realm work
        request: { headers: { host: 'localhost:4200' } },
      });
    },
    getIndexHTML: async () =>
      readFileSync(join(distPath, 'index.html')).toString(),
  };
}

function btoa(str: string | Buffer) {
  let buffer;
  if (str instanceof Buffer) {
    buffer = str;
  } else {
    buffer = Buffer.from(str.toString(), 'binary');
  }
  return buffer.toString('base64');
}

function atob(base64: string | Buffer) {
  let buffer;
  if (base64 instanceof Buffer) {
    buffer = base64;
  } else {
    buffer = Buffer.from(base64.toString(), 'base64');
  }
  return buffer.toString('ascii');
}
