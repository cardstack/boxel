import { sync as glob } from "glob";
import {
  existsSync,
  readFileSync,
  ensureFileSync,
  writeFileSync,
  readJSONSync,
  writeJSONSync,
} from "fs-extra";
import { join } from "path";
// import { dirSync } from "tmp";
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
import {
  createSourceFile,
  createProgram,
  ScriptTarget,
  CompilerHost,
} from "typescript";

const executableGlob = "**/*.{js,ts,gjs,gts}";
const skyPackURL = "//cdn.skypack.dev";

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
let typesDir = join("types", "skypack");
console.log(`Adding type information to ${typesDir}`);
(async () => {
  for (let importHref of imports) {
    let importHrefWithProtocol = !importHref.startsWith("http")
      ? "https:" + importHref
      : importHref;
    let response = await fetch(`${importHrefWithProtocol}?dts`);
    let dtsHref = response.headers.get("X-TypeScript-Types");
    if (!dtsHref) {
      console.error(`could not determine dts location for ${importHref}`);
      continue;
    }
    let importName = importHref.slice(
      importHref.indexOf(skyPackURL) + skyPackURL.length + 1
    );
    console.log(`found dts for ${importName}: ${dtsHref}`);
    let dtsURL = new URL(dtsHref, importHrefWithProtocol);
    await crawl(importName, dtsURL);
    let tsConfig = readJSONSync("tsconfig.json");
    let pkgPathSegments = join(typesDir, dtsURL.pathname).split("/");
    pkgPathSegments.pop();
    let pkgPath = pkgPathSegments.join("/");
    tsConfig.compilerOptions.paths[importHref] = [pkgPath];
    writeJSONSync("tsconfig.json", tsConfig, { spaces: 2 });
  }

  console.log("done");
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

async function crawl(
  importFolder: string,
  dtsURL: URL,
  visited: string[] = []
) {
  if (visited.includes(dtsURL.href)) {
    return;
  }

  let source = await (await fetch(dtsURL.href)).text();
  let localPath = join(typesDir, dtsURL.pathname);
  ensureFileSync(localPath);
  writeFileSync(localPath, source);
  console.log(`wrote DTS file for ${dtsURL.href}: ${localPath}`);
  let references = findReferences(localPath, source);
  for (let reference of references) {
    await crawl(importFolder, new URL(reference, dtsURL.href), [
      ...visited,
      dtsURL.href,
    ]);
  }
}

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

function findReferences(filename: string, source: string): string[] {
  const compilerHost: CompilerHost = {
    fileExists: () => true,
    getCanonicalFileName: (_filename) => _filename,
    getCurrentDirectory: () => "",
    getDefaultLibFileName: () => "lib.d.ts",
    getNewLine: () => "\n",
    getSourceFile: (_filename) => {
      return createSourceFile(_filename, source, ScriptTarget.Latest, true);
    },
    readFile: () => undefined,
    useCaseSensitiveFileNames: () => true,
    writeFile: () => null,
  };
  const program = createProgram(
    [filename],
    {
      noResolve: true,
      target: ScriptTarget.Latest,
    },
    compilerHost
  );
  const sourceFile = program.getSourceFile(filename);
  if (!sourceFile) {
    throw new Error(`unable to parse ${filename}`);
  }

  return sourceFile.referencedFiles.map((r) => r.fileName);
}
