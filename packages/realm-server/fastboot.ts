//@ts-expect-error no types for fastboot
import FastBoot from 'fastboot';
import { type FastBootInstance } from '@cardstack/runtime-common';
import { instantiateFastBoot } from './fastboot-from-deployed';
import {
  type IndexRunner,
  type RunnerOpts,
} from '@cardstack/runtime-common/search-index';

const appName = '@cardstack/host';
export async function makeFastBootIndexRunner(
  dist: URL | string,
  getRunnerOpts: (optsId: number) => RunnerOpts
): Promise<IndexRunner> {
  let fastboot: FastBootInstance;
  if (typeof dist === 'string') {
    fastboot = new FastBoot({
      distPath: dist,
      resilient: false,
      buildSandboxGlobals(defaultGlobals: any) {
        return Object.assign({}, defaultGlobals, {
          URL: globalThis.URL,
          Request: globalThis.Request,
          Response: globalThis.Response,
          btoa,
          getRunnerOpts,
        });
      },
    }) as FastBootInstance;
  } else {
    fastboot = await instantiateFastBoot(
      appName,
      dist,
      (defaultGlobals: any) => {
        return Object.assign({}, defaultGlobals, {
          URL: globalThis.URL,
          Request: globalThis.Request,
          Response: globalThis.Response,
          btoa,
          getRunnerOpts,
        });
      }
    );
  }
  return async (optsId: number) => {
    await fastboot.visit(`/indexer/${optsId}`, {
      // TODO we'll need to configure this host origin as part of the hosted realm work
      request: { headers: { host: 'localhost:4200' } },
    });
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
