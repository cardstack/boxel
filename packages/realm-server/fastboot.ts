//@ts-expect-error no types for fastboot
import FastBoot from 'fastboot';
import { type FastBootInstance } from './fastboot-from-deployed';
import { instantiateFastBoot } from './fastboot-from-deployed';
import {
  type IndexRunner,
  type RunnerOpts,
} from '@cardstack/runtime-common/search-index';
import { JSDOM } from 'jsdom';
import * as Sentry from '@sentry/node';

const appName = '@cardstack/host';
export async function makeFastBootIndexRunner(
  dist: URL | string,
  getRunnerOpts: (optsId: number) => RunnerOpts,
): Promise<{ getRunner: IndexRunner; distPath: string }> {
  let fastboot: FastBootInstance;
  let distPath: string;
  if (typeof dist === 'string') {
    distPath = dist;
    fastboot = new FastBoot({
      distPath,
      resilient: false,
      buildSandboxGlobals(defaultGlobals: any) {
        let sentryScope = Sentry.getCurrentScope();
        console.log('sentry scope', sentryScope);
        // debugger;
        console.log(
          'does error reporter exist when setting up fastboot v1',
          globalThis.errorReporter,
        );
        return Object.assign({}, defaultGlobals, {
          errorReporter: globalThis.errorReporter,
          __SENTRY__: globalThis.__SENTRY__,
          URL: globalThis.URL,
          Request: globalThis.Request,
          Response: globalThis.Response,
          btoa,
          getRunnerOpts,
          _logDefinitions: (globalThis as any)._logDefinitions,
          jsdom: new JSDOM(''),
        });
      },
    }) as FastBootInstance;
  } else {
    ({ fastboot, distPath } = await instantiateFastBoot(
      appName,
      dist,
      (defaultGlobals: any) => {
        console.log(
          'does error reporter exist when setting up fastboot v2',
          globalThis.errorReporter,
        );
        return Object.assign({}, defaultGlobals, {
          errorReporter: globalThis.errorReporter,
          URL: globalThis.URL,
          Request: globalThis.Request,
          Response: globalThis.Response,
          btoa,
          getRunnerOpts,
          _logDefinitions: (globalThis as any)._logDefinitions,
          jsdom: new JSDOM(''),
        });
      },
    ));
  }
  return {
    getRunner: async (optsId: number) => {
      await fastboot.visit(`/indexer/${optsId}`, {
        // TODO we'll need to configure this host origin as part of the hosted realm work
        request: { headers: { host: 'localhost:4200' } },
      });
    },
    distPath,
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
