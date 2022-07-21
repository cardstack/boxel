import yargs from "yargs";
import { RealmServer } from "./server";

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

let app = new RealmServer(path, new URL(url)).start();
app.listen(port);
console.log(
  `realm server listening on port ${port} as url ${url} with realm dir ${path}`
);
