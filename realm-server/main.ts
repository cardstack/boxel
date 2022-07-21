import yargs from "yargs";
import { createRealmServer } from "./server";

let { port, path, url } = yargs(process.argv.slice(2))
  .usage("Start realm server")
  .options({
    port: {
      description: "port number",
      demandOption: true,
      type: "number",
    },
    url: {
      description: "realm URL",
      demandOption: true,
      type: "string",
    },
    path: {
      description: "realm directory path",
      demandOption: true,
      type: "string",
    },
  })
  .parseSync();

let server = createRealmServer(path, new URL(url));
server.listen(port);
console.log(
  `realm server listening on port ${port} as url ${url} with realm dir ${path}`
);
