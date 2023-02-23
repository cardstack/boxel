import yargs from "yargs";
import log, { LogLevelNames } from "loglevel";
import fs from "fs";
import { execSync } from "child_process";

let { path, url, logLevel } = yargs(process.argv.slice(2))
  .usage("Fetch host Fastboot assets")
  .options({
    url: {
      description: "URL to fetch assets from",
      demandOption: true,
      type: "string",
    },
    path: {
      description: "Path to unzip assets into",
      type: "string",
      default: "./",
    },
    logLevel: {
      description: "how detailed log output should be",
      choices: ["trace", "debug", "info", "warn", "error"],
      default: "info",
    },
  })
  .parseSync();

log.setLevel(logLevel as LogLevelNames);
log.info(`Set fetch-dist log level to ${logLevel}`);

if (!path.endsWith("/")) {
  path = `${path}/`;
}

if (!url.endsWith("/")) {
  url = `${url}/`;
}

(async () => {
  // FIXME this surely does nothing?
  try {
    let indirectionUrl = `${url}fastboot-deploy-info.json`;

    log.debug(`Fetching deployment info from ${indirectionUrl}`);
    let response = await fetch(indirectionUrl);

    let json = await response.json();

    log.debug(`JSON response: ${JSON.stringify(json, null, 2)}`);
    let key = json.key;

    let zipUrl = `${url}${key}`;
    log.info(`Fetching zip from ${zipUrl}`);

    let zipResponse = await fetch(zipUrl);
    let zipBuffer = await zipResponse.arrayBuffer();

    process.chdir(path);

    let pathToZip = key;

    log.debug(`Writing zip to ${pathToZip}`);
    fs.writeFileSync(pathToZip, Buffer.from(zipBuffer));

    log.debug(`Extracting zip`);
    execSync(`unzip -q ${pathToZip}`);

    log.debug(`Deleting zip`);
    fs.rmSync(pathToZip);
  } catch (e: any) {
    console.log("error in try", e);
  }
})().catch((e: any) => {
  log.error(`Unexpected error fetching dist, stopping`, e);
  process.exit(1);
});
