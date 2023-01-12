import { writeFileSync, writeJSONSync } from "fs-extra";
import { NodeAdapter } from "../../node-realm";
import { resolve, join } from "path";
import { Realm, LooseSingleCardDocument } from "@cardstack/runtime-common";
import { makeFastBootIndexRunner } from "../../fastboot";
import type * as CardAPI from "https://cardstack.com/base/card-api";
import { type RunnerOpts } from "@cardstack/runtime-common/search-index";

export const testRealm = "http://test-realm/";

let runnerOpts: RunnerOpts | undefined;
function setRunnerOpts(opts: RunnerOpts) {
  runnerOpts = opts;
}
function getRunnerOpts() {
  if (!runnerOpts) {
    throw new Error(`RunnerOpts have not been set`);
  }
  return runnerOpts;
}
let getRunner = makeFastBootIndexRunner(
  resolve(__dirname, "..", "..", "..", "host", "dist"),
  getRunnerOpts
);

export function createRealm(
  dir: string,
  flatFiles: Record<string, string | LooseSingleCardDocument> = {},
  realmURL = testRealm
): Realm {
  for (let [filename, contents] of Object.entries(flatFiles)) {
    if (typeof contents === "string") {
      writeFileSync(join(dir, filename), contents);
    } else {
      writeJSONSync(join(dir, filename), contents);
    }
  }
  return new Realm(realmURL, new NodeAdapter(dir), getRunner, setRunnerOpts);
}

export function setupCardLogs(
  hooks: NestedHooks,
  apiThunk: () => Promise<typeof CardAPI>
) {
  hooks.afterEach(async function () {
    let api = await apiThunk();
    await api.flushLogs();
  });
}
