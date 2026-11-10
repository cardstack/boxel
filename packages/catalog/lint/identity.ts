// Finds the exported card and field definitions that have no identity because
// they are made by a call the module doesn't wrap in `markDefinition`.
//
// A class a module writes gets its identity from the compiler. A definition a
// module makes by calling a function, such as `enumField(...)` or a realm's
// own factory, gets one only when the module wraps the call in
// `markDefinition`, imported from `@cardstack/base/mark-definition` (ADR 010
// §1.4.5). Without the wrap the module compiles, lints and type-checks, and
// the definition fails only when something has to name it, with "has no
// identity". This check reports it at lint time instead.
//
// Whether a call makes a definition is a question about its type, not its
// name: any function can return a class. So this builds one TypeScript
// program over the files and reports an exported binding, or a default
// export, whose value is an unwrapped call that returns a constructor of a
// `BaseDef` subclass. A definition that isn't exported is left alone: nothing
// can name it, and the compiler rejects `markDefinition` anywhere but the
// value of an exported binding or the default export.
//
// Run from packages/catalog:
//
//   node lint/identity.ts [dir]
//
// It checks every .gts and .ts file under `dir` (default `contents`) and
// prints one line per definition, `file(line,col): error mark-definition:
// message`, the shape scripts/lint-sweep.ts reads. It exits 1 when it reports
// any, and 2 when it can't run.
//
// It lives outside scripts/ because boxel-catalog's own CI Lint deletes that
// folder before it runs this package's `pnpm lint`.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import {
  markDefinitionModule,
  otherBaseSpelling,
} from '../../runtime-common/export-identity-plugin.ts';

const require = createRequire(import.meta.url);
const { Preprocessor } = require('content-tag') as typeof import('content-tag');

export const ruleName = 'mark-definition';
const markDefinitionName = 'markDefinition';
const baseDefModule = '@cardstack/base/card-api';

export interface UnmarkedDefinition {
  file: string;
  line: number;
  column: number;
  // The name the definition is exported under; absent for a report on the
  // import of `markDefinition` itself.
  exportedName: string | undefined;
  message: string;
}

// A .gts module is presented to TypeScript as the .ts its templates compile
// to. TypeScript looks for an extensionless import of it as `x.ts`, and for
// one written with the extension as `x.gts.ts`; both names read the .gts.
function gtsSourceOf(fileName: string): string | undefined {
  if (fileName.endsWith('.gts.ts')) {
    let gts = fileName.slice(0, -'.ts'.length);
    return ts.sys.fileExists(gts) ? gts : undefined;
  }
  if (fileName.endsWith('.ts') && !fileName.endsWith('.d.ts')) {
    let gts = fileName.replace(/\.ts$/, '.gts');
    if (!ts.sys.fileExists(fileName) && ts.sys.fileExists(gts)) {
      return gts;
    }
  }
  return undefined;
}

// The one name a .gts module goes by in the program. An import resolved to
// either of its names is pointed at this one, since TypeScript keeps a module
// reached under two names as two modules, each with its own classes.
function tsNameOf(gtsFile: string): string {
  let plain = gtsFile.replace(/\.gts$/, '.ts');
  return ts.sys.fileExists(plain) ? `${gtsFile}.ts` : plain;
}

function compilerHost(options: ts.CompilerOptions) {
  let host = ts.createCompilerHost(options, true);
  let preprocessor = new Preprocessor();
  // The source map of each compiled .gts, by the name the program knows it
  // by, so a position in the compiled code is reported in the .gts.
  let sourceMaps = new Map<string, Segment[][]>();
  let getSourceFile = host.getSourceFile.bind(host);
  let cache = ts.createModuleResolutionCache(
    host.getCurrentDirectory(),
    (fileName) => fileName,
    options,
  );
  let resolve = (specifier: string, containingFile: string) => {
    let resolution = ts.resolveModuleName(
      specifier,
      containingFile,
      options,
      host,
      cache,
    );
    let resolved = resolution.resolvedModule;
    let gts = resolved && gtsSourceOf(resolved.resolvedFileName);
    if (resolved && gts !== undefined) {
      return {
        ...resolution,
        resolvedModule: { ...resolved, resolvedFileName: tsNameOf(gts) },
      };
    }
    return resolution;
  };
  host.resolveModuleNameLiterals = (literals, containingFile) =>
    literals.map((literal) => resolve(literal.text, containingFile));
  host.fileExists = (fileName) =>
    ts.sys.fileExists(fileName) || gtsSourceOf(fileName) !== undefined;
  host.readFile = (fileName) => {
    let gts = gtsSourceOf(fileName);
    if (gts === undefined) {
      return ts.sys.readFile(fileName);
    }
    let { code, map } = preprocessor.process(readFileSync(gts, 'utf8'), {
      filename: gts,
    });
    sourceMaps.set(fileName, decodeMappings(JSON.parse(map).mappings));
    return code;
  };
  host.getSourceFile = (fileName, languageVersion, onError) => {
    if (gtsSourceOf(fileName) === undefined) {
      return getSourceFile(fileName, languageVersion, onError);
    }
    let text = host.readFile(fileName);
    return text === undefined
      ? undefined
      : ts.createSourceFile(fileName, text, languageVersion, true);
  };
  let originalPosition = (fileName: string, line: number, column: number) => {
    let lines = sourceMaps.get(fileName);
    if (!lines) {
      return { line, column };
    }
    let segment = [...(lines[line] ?? [])]
      .reverse()
      .find((s) => s.column <= column);
    return segment
      ? {
          line: segment.sourceLine,
          column: segment.sourceColumn + (column - segment.column),
        }
      : { line, column };
  };
  return { host, resolve, originalPosition };
}

interface Segment {
  column: number;
  sourceLine: number;
  sourceColumn: number;
}

// Decodes a source map's `mappings` into, for each generated line, the
// segments that map a generated column to a line and column in the source.
// Every map here has the one source, the .gts it was compiled from.
function decodeMappings(mappings: string): Segment[][] {
  let alphabet =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let lines: Segment[][] = [];
  let sourceLine = 0;
  let sourceColumn = 0;
  for (let lineText of mappings.split(';')) {
    let segments: Segment[] = [];
    let column = 0;
    for (let segmentText of lineText.split(',')) {
      if (!segmentText) {
        continue;
      }
      let fields: number[] = [];
      let value = 0;
      let shift = 0;
      for (let char of segmentText) {
        let digit = alphabet.indexOf(char);
        value += (digit & 31) << shift;
        if (digit & 32) {
          shift += 5;
        } else {
          fields.push(value & 1 ? -(value >>> 1) : value >>> 1);
          value = 0;
          shift = 0;
        }
      }
      column += fields[0];
      if (fields.length >= 4) {
        sourceLine += fields[2];
        sourceColumn += fields[3];
        segments.push({ column, sourceLine, sourceColumn });
      }
    }
    lines.push(segments);
  }
  return lines;
}

// The local names `markDefinition` is imported under, and the namespaces its
// module is imported as. The compiler recognizes it by exactly these forms.
// An import of it from another spelling of a base module is one the compiler
// refuses; a call through that name counts as wrapped here, so the import
// itself is what gets reported.
function markDefinitionImports(sourceFile: ts.SourceFile) {
  let names = new Set<string>();
  let namespaces = new Set<string>();
  let misspelled: { specifier: ts.ImportSpecifier; source: string }[] = [];
  for (let statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }
    let source = statement.moduleSpecifier.text;
    let bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) {
      if (source === markDefinitionModule) {
        namespaces.add(bindings.name.text);
      }
    } else if (bindings) {
      for (let element of bindings.elements) {
        if (
          (element.propertyName ?? element.name).text !== markDefinitionName
        ) {
          continue;
        }
        if (source === markDefinitionModule) {
          names.add(element.name.text);
        } else if (otherBaseSpelling.test(source)) {
          names.add(element.name.text);
          misspelled.push({ specifier: element, source });
        }
      }
    }
  }
  return { names, namespaces, misspelled };
}

function unwrap(expression: ts.Expression): ts.Expression {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    expression = expression.expression;
  }
  return expression;
}

function isMarked(
  call: ts.CallExpression,
  imports: ReturnType<typeof markDefinitionImports>,
) {
  let callee = call.expression;
  if (ts.isIdentifier(callee)) {
    return imports.names.has(callee.text);
  }
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    imports.namespaces.has(callee.expression.text) &&
    callee.name.text === markDefinitionName
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind) {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((m) => m.kind === kind)
  );
}

// Maps each local binding that an `export { … }` or `export default <name>`
// exports to the first name it is exported under, in source order, which is
// the name the compiler tags it with.
function separatelyExportedNames(sourceFile: ts.SourceFile) {
  let names = new Map<string, string>();
  for (let statement of sourceFile.statements) {
    if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      ts.isIdentifier(statement.expression)
    ) {
      if (!names.has(statement.expression.text)) {
        names.set(statement.expression.text, 'default');
      }
    } else if (
      ts.isExportDeclaration(statement) &&
      !statement.moduleSpecifier &&
      !statement.isTypeOnly &&
      statement.exportClause &&
      ts.isNamedExports(statement.exportClause)
    ) {
      for (let element of statement.exportClause.elements) {
        let local = (element.propertyName ?? element.name).text;
        if (!element.isTypeOnly && !names.has(local)) {
          names.set(local, element.name.text);
        }
      }
    }
  }
  return names;
}

// The exported values a module computes with a call it doesn't mark, each
// with the name it is exported under and the call.
function unmarkedExportedCalls(
  sourceFile: ts.SourceFile,
  imports: ReturnType<typeof markDefinitionImports>,
) {
  let exportedNames = separatelyExportedNames(sourceFile);
  let found: {
    exportedName: string;
    // The binding the value is declared as, when its declaration isn't the
    // export itself, as in `const X = …; export { X as Y }`.
    localName?: string;
    call: ts.CallExpression;
    binding: ts.Node;
  }[] = [];
  function consider(
    exportedName: string,
    value: ts.Expression,
    binding: ts.Node,
    localName?: string,
  ) {
    let call = unwrap(value);
    if (ts.isCallExpression(call) && !isMarked(call, imports)) {
      found.push({ exportedName, localName, call, binding });
    }
  }
  for (let statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      if (hasModifier(statement, ts.SyntaxKind.DeclareKeyword)) {
        continue;
      }
      let exported = hasModifier(statement, ts.SyntaxKind.ExportKeyword);
      for (let declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name) || !declaration.initializer) {
          continue;
        }
        let exportedName = exported
          ? declaration.name.text
          : exportedNames.get(declaration.name.text);
        if (exportedName !== undefined) {
          consider(
            exportedName,
            declaration.initializer,
            declaration.name,
            exported ? undefined : declaration.name.text,
          );
        }
      }
    } else if (
      ts.isExportAssignment(statement) &&
      !statement.isExportEquals &&
      !ts.isIdentifier(statement.expression)
    ) {
      consider('default', statement.expression, statement.expression);
    }
  }
  return found;
}

function baseDefInstanceType(
  program: ts.Program,
  checker: ts.TypeChecker,
  resolve: ReturnType<typeof compilerHost>['resolve'],
  fromFile: string,
) {
  let resolved = resolve(baseDefModule, fromFile).resolvedModule;
  let sourceFile = resolved && program.getSourceFile(resolved.resolvedFileName);
  let moduleSymbol = sourceFile && checker.getSymbolAtLocation(sourceFile);
  let baseDef =
    moduleSymbol &&
    checker
      .getExportsOfModule(moduleSymbol)
      .find((symbol) => symbol.name === 'BaseDef');
  if (!baseDef) {
    throw new Error(
      `can't find BaseDef in ${baseDefModule}; check the paths in the tsconfig`,
    );
  }
  return checker.getDeclaredTypeOfSymbol(baseDef);
}

// Whether a value of this type is a card or field definition: a constructor
// whose instances are BaseDefs.
function isDefinition(
  checker: ts.TypeChecker,
  type: ts.Type,
  baseDef: ts.Type,
): boolean {
  return checker
    .getSignaturesOfType(type, ts.SignatureKind.Construct)
    .some((signature) => {
      let instance = signature.getReturnType();
      return (
        !(instance.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) &&
        checker.isTypeAssignableTo(instance, baseDef)
      );
    });
}

export function findUnmarkedDefinitions({
  files,
  compilerOptions,
}: {
  files: string[];
  compilerOptions: ts.CompilerOptions;
}): UnmarkedDefinition[] {
  let options: ts.CompilerOptions = {
    ...compilerOptions,
    noEmit: true,
    // Bundler resolution finds a sibling module without its extension, the
    // way the realm's loader does, whatever format a file would have as CJS
    // or ESM.
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
  };
  let { host, resolve, originalPosition } = compilerHost(options);
  let rootNames = files.map((file) =>
    file.endsWith('.gts') ? tsNameOf(file) : file,
  );
  let realNameOf = new Map(rootNames.map((name, i) => [name, files[i]]));
  let program = ts.createProgram({ rootNames, options, host });
  let checker = program.getTypeChecker();
  let baseDef: ts.Type | undefined;

  let found: UnmarkedDefinition[] = [];
  for (let rootName of rootNames) {
    let sourceFile = program.getSourceFile(rootName);
    if (!sourceFile) {
      continue;
    }
    let position = (node: ts.Node) => {
      let generated = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      let { line, column } = originalPosition(
        rootName,
        generated.line,
        generated.character,
      );
      return { line: line + 1, column: column + 1 };
    };
    let imports = markDefinitionImports(sourceFile);
    for (let { specifier, source } of imports.misspelled) {
      found.push({
        file: realNameOf.get(rootName)!,
        ...position(specifier),
        exportedName: undefined,
        message: `import ${markDefinitionName} from '${markDefinitionModule}', not '${source}'. The compiler recognizes it only by that specifier.`,
      });
    }
    let candidates = unmarkedExportedCalls(sourceFile, imports);
    if (candidates.length === 0) {
      continue;
    }
    baseDef ??= baseDefInstanceType(program, checker, resolve, rootName);
    for (let { exportedName, localName, call, binding } of candidates) {
      if (!isDefinition(checker, checker.getTypeAtLocation(binding), baseDef)) {
        continue;
      }
      // The callee's own text, on one line, since each report is one line.
      let callee = call.expression.getText(sourceFile).replace(/\s+/g, '');
      let wrapped =
        localName !== undefined
          ? `const ${localName} = markDefinition(${callee}(...))`
          : exportedName === 'default'
            ? `export default markDefinition(${callee}(...))`
            : `export const ${exportedName} = markDefinition(${callee}(...))`;
      found.push({
        file: realNameOf.get(rootName)!,
        ...position(call),
        exportedName,
        message:
          `${exportedName === 'default' ? 'The default export' : exportedName} ` +
          `is a definition made by a call, so it has no identity until the call ` +
          `is wrapped: ${wrapped}, with markDefinition imported from ` +
          `'${markDefinitionModule}'.`,
      });
    }
  }
  return found;
}

export function moduleFiles(dir: string): string[] {
  let files: string[] = [];
  for (let entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
      continue;
    }
    let path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...moduleFiles(path));
    } else if (
      /\.(gts|ts)$/.test(entry.name) &&
      !entry.name.endsWith('.d.ts')
    ) {
      files.push(path);
    }
  }
  return files;
}

export function compilerOptionsFrom(tsconfigPath: string): ts.CompilerOptions {
  let config = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
  if (config.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(config.error.messageText, '\n'),
    );
  }
  return ts.parseJsonConfigFileContent(
    config.config,
    ts.sys,
    resolve(tsconfigPath, '..'),
  ).options;
}

function main() {
  let catalogDir = process.cwd();
  let dir = resolve(catalogDir, process.argv[2] ?? 'contents');
  if (!existsSync(dir)) {
    console.error(`lint-identity: there is no ${dir} to check`);
    process.exit(2);
  }
  let found: UnmarkedDefinition[];
  try {
    found = findUnmarkedDefinitions({
      files: moduleFiles(dir),
      compilerOptions: compilerOptionsFrom(join(catalogDir, 'tsconfig.json')),
    });
  } catch (error) {
    console.error(`lint-identity: ${(error as Error).message}`);
    process.exit(2);
  }
  for (let d of found) {
    console.log(
      `${relative(catalogDir, d.file)}(${d.line},${d.column}): error ${ruleName}: ${d.message}`,
    );
  }
  process.exit(found.length > 0 ? 1 : 0);
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '')) {
  main();
}
