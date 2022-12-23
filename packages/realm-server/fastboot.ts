//@ts-expect-error no types for fastboot
import FastBoot from "fastboot";
import { type FastBootInstance } from "@cardstack/runtime-common";
import { type GetVisitor } from "@cardstack/runtime-common/search-index";

export function makeFastBootVisitor(distPath: string): GetVisitor {
  return ({ _fetch, resolver, reader, setRunState, getRunState }) => {
    // something to think about--if there is a dramatic performance hit for
    // creating a new fastboot instance for each current run, maybe we can look
    // at reusing an existing fastboot instances? we could use the loader
    // service in the ember app within the fastboot VM to reset the loader
    // instead of making a new fastboot instance. Although we'd need to be
    // careful about fastboot instances shared by different current runs. we
    // wouldn't want loader state to bleed into different current runs. maybe
    // the idea is that we could lazily create a pool of fastboot instances that
    // we reuse after the current run's lifetime.
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
          resolver,
          reader,
          setRunState,
          getRunState,
        });
      },
    }) as FastBootInstance;
    return async (url) => {
      let page = await fastboot.visit(url, {
        request: { headers: { host: "localhost:4200" } },
      });
      let html = page.html();
      return html;
    };
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
