//@ts-expect-error no types for fastboot
import FastBoot from "fastboot";
import { type FastBootInstance } from "@cardstack/runtime-common";

export function makeFastBootVisitor(
  distPath: string
): (_fetch: typeof fetch) => (url: string) => Promise<string> {
  return (_fetch: typeof fetch) => {
    // something to think about--if there is a dramatic performance hit for
    // creating a new fastboot instance, maybe we can look at reusing an
    // existing one? we could use the loader service in the ember app within the
    // fastboot VM to reset the loader instead of making a new fastboot
    // instance. Although we'd need to be careful about fastboot instances
    // shared by different current runs. we wouldn't want loader state to bleed
    // into different current runs.
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
        });
      },
    }) as FastBootInstance;
    return async (url: string) => {
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
