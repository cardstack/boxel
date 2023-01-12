//@ts-expect-error no types for fastboot
import FastBoot from "fastboot";
import { type FastBootInstance } from "@cardstack/runtime-common";
import { type IndexRunner } from "@cardstack/runtime-common/search-index";

export function makeFastBootIndexRunner(distPath: string): IndexRunner {
  return async ({ _fetch, reader, entrySetter, registerRunner }) => {
    // TODO we should be able to hoist the creation of the fastboot service to
    // outside of this function. However, the fetch that gets passed in will
    // probably have to be a function that lazily gets the fetch, as each
    // current run will likely have an outside fetch that could be different.
    // The registerRunnner and entrySetter may fall into the same boat since we
    // wont have these available yet outside of this function.
    let fastboot = new FastBoot({
      distPath,
      resilient: false,
      buildSandboxGlobals(defaultGlobals: any) {
        return Object.assign({}, defaultGlobals, {
          URL: globalThis.URL,
          Request: globalThis.Request,
          Response: globalThis.Response,
          fetch: _fetch,
          btoa,
          reader,
          entrySetter,
          registerRunner,
        });
      },
    }) as FastBootInstance;
    await fastboot.visit("/indexer", {
      // TODO we'll need to configure this host origin as part of the hosted realm work
      request: { headers: { host: "localhost:4200" } },
    });
  };
}

function btoa(str: string | Buffer) {
  let buffer;
  if (str instanceof Buffer) {
    buffer = str;
  } else {
    buffer = Buffer.from(str.toString(), "binary");
  }
  return buffer.toString("base64");
}
