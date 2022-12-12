//@ts-expect-error no types for fastboot
import FastBoot from "fastboot";
import { type FastBootInstance } from "@cardstack/runtime-common";

export function makeFastBoot(distPath: string) {
  return (
    urlHandlers: Map<string, (req: Request) => Promise<Response>>,
    urlMappings: Map<string, string>,
    staticResponses: Map<string, string>
  ) => {
    return new FastBoot({
      distPath,
      resilient: false,
      buildSandboxGlobals(defaultGlobals: any) {
        return Object.assign({}, defaultGlobals, {
          URL: globalThis.URL,
          Request: globalThis.Request,
          Response: globalThis.Response,
          fetch: globalThis.fetch,
          btoa,
          urlHandlers,
          urlMappings,
          staticResponses,
        });
      },
    }) as FastBootInstance;
  };
}

export async function visit(url: string, fastboot: FastBootInstance) {
  let page = await fastboot.visit(url, {
    request: { headers: { host: "localhost:4200" } },
  });
  let html = page.html();
  return html;
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
