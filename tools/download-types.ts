import { sync as glob } from "glob";
import {
  existsSync,
  readFileSync,
  ensureFileSync,
  writeFileSync,
} from "fs-extra";
import { join } from "path";
import { dirSync } from "tmp";
import * as babel from "@babel/core";
import type * as BabelType from "@babel/core";
import type { types as t } from "@babel/core";
import type { NodePath } from "@babel/traverse";
import { parseTemplates } from "ember-template-imports/lib/parse-templates";
//@ts-ignore unsure where these types live
import decoratorsPlugin from "@babel/plugin-syntax-decorators";
//@ts-ignore unsure where these types live
import classPropertiesPlugin from "@babel/plugin-syntax-class-properties";
//@ts-ignore unsure where these types live
import typescriptPlugin from "@babel/plugin-syntax-typescript";
//@ts-ignore unsure where these types live
import typescriptPlugin from "@babel/plugin-transform-typescript";
import fetch from "node-fetch";

const executableGlob = "**/*.{js,ts,gjs,gts}";
const skyPackURL = "https://cdn.skypack.dev";

let localRealmDir = process.argv[2];
if (!localRealmDir) {
  console.error(`please provide the path to the local realm`);
  process.exit(1);
}

if (!existsSync("tsconfig.json")) {
  console.error(`could not find ${process.cwd()}/tsconfig.json`);
  process.exit(1);
}

let paths = glob(`${localRealmDir}/${executableGlob}`);
let imports = new Set<string>();
for (let path of paths) {
  let source = preprocessTemplateTags(path);
  babel.transformSync(source, {
    filename: path,
    plugins: [
      typescriptPlugin,
      [decoratorsPlugin, { legacy: true }],
      classPropertiesPlugin,
      [gatherImportsPlugin, imports],
    ],
  })!.code!;
}
if (imports.size === 0) {
  console.log("No skypack imports found");
  process.exit(0);
}
let { name: tmpdir } = dirSync();
console.log(`Adding type information to ${tmpdir}`);
(async () => {
  for (let importHref of imports) {
    let response = await fetch(`${importHref}?dts`);
    let dtsHref = response.headers.get("X-TypeScript-Types");
    if (!dtsHref) {
      console.error(`could not determine dts location for ${importHref}`);
      continue;
    }
    let importName = importHref.slice(skyPackURL.length + 1).replace("/", "_");
    console.log(`found dts for ${importName}: ${dtsHref}`);
    let dtsURL = new URL(dtsHref, skyPackURL);
    let dts = await (await fetch(dtsURL.href)).text();
    let dtsPath = join(tmpdir, importName, ".d.ts");
    ensureFileSync(dtsPath);
    writeFileSync(dtsPath, dts);
    console.log(`wrote DTS file for ${importHref}: ${dtsPath}`);
  }

  console.log("done");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

// async function crawl(
//   importName: string,
//   dtsHref: string,
//   visited: string[] = []
// ) {
//   if (visited.includes(dtsHref)) {
//     return;
//   }

//   let dtsURL = new URL(dtsHref, skyPackURL);
//   let dts = await (await fetch(dtsURL.href)).text();
//   let dtsPath = join(tmpdir, importName, "index.d.ts");
//   ensureFileSync(dtsPath);
//   writeFileSync(dtsPath, dts);
//   console.log(`wrote DTS file for ${importName}: ${dtsPath}`);
//   let references = findImports(dts);
//   let parts = dtsURL.pathname.split("/").pop()!.split(",");
//   let mode = parts.find((p) => p.startsWith("mode="));
//   if (mode) {
//     let modeSegments = mode.split("/");
//     modeSegments.pop();
//     for (let reference of references) {
//       let refHref = dtsURL.href.replace(
//         mode,
//         [...modeSegments, reference].join("/")
//       );
//       crawl(importName, refHref, [...visited, dtsHref]);
//     }
//   }
// }

interface State {
  opts: Set<string>;
}

function gatherImportsPlugin(_babel: typeof BabelType) {
  // let t = babel.types;
  return {
    visitor: {
      ImportDeclaration(path: NodePath<t.ImportDeclaration>, state: State) {
        let importSources = state.opts;
        if (!importSources) {
          importSources = new Set();
          state.opts = importSources;
        }

        let source = path.node.source.value;
        if (source.includes(skyPackURL)) {
          importSources.add(source);
        }
      },
    },
  };
}

function preprocessTemplateTags(path: string): string {
  let source = readFileSync(path, { encoding: "utf8" });
  let output = [];
  let offset = 0;
  let matches = parseTemplates(source, path, "template");
  for (let match of matches) {
    output.push(source.slice(offset, match.start.index));
    output.push("[templte(`"); // use back tick so we can be tolerant of newlines
    output.push(
      source
        .slice(match.start.index! + match.start[0].length, match.end.index)
        .replace(/`/g, "\\`")
    );
    output.push("`)]        ");
    offset = match.end.index! + match.end[0].length;
  }
  output.push(source.slice(offset));
  return output.join("");
}

// function findImports(source: string): string[] {
//   let regexs = [
//     /\bpath\s*=\s*"([^"]*)"/g,
//     /\bpath\s*=\s*'([^']*)'/g,
//     /\s+from\s+"([^"]+)"/g,
//     /\s+from\s+'([^']+)'/g,
//   ];
//   let imports = new Set<string>();
//   for (let regex of regexs) {
//     let matches = source.matchAll(regex);
//     for (let match of matches) {
//       imports.add(match[1]);
//     }
//   }
//   return [...imports];
// }
