// Reports every `new URL(x)` whose argument is typed as a realm identifier.
//
// `RealmIdentifier` and `RealmResourceIdentifier` are branded strings, so
// `new URL(identifier)` typechecks and throws only at runtime, and only for the
// canonical form — the compiler is structurally unable to flag it. This walks
// the same type information the compiler has and asks the question directly.
//
// Usage: node scripts/find-url-on-realm-identifier.mjs <tsconfig> [...]
import ts from 'typescript';
import { relative } from 'path';

const BRANDS = ['__riBrand', '__rriBrand'];

function brandOf(type, checker) {
  const seen = new Set();
  const walk = (t) => {
    if (!t || seen.has(t)) return undefined;
    seen.add(t);
    for (const brand of BRANDS) {
      if (t.getProperty?.(brand)) return brand;
    }
    // A branded string is an intersection; a union may carry one in a member.
    for (const part of t.types ?? []) {
      const found = walk(part);
      if (found) return found;
    }
    const apparent = checker.getApparentType(t);
    if (apparent !== t) return walk(apparent);
    return undefined;
  };
  return walk(type);
}

const configs = process.argv.slice(2);
if (configs.length === 0) {
  console.error(
    'usage: node scripts/find-url-on-realm-identifier.mjs <tsconfig>...',
  );
  process.exit(2);
}

let total = 0;
for (const configPath of configs) {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) =>
        console.error(ts.flattenDiagnosticMessageText(d.messageText, '\n')),
    },
  );
  if (!parsed) continue;

  const program = ts.createProgram(parsed.fileNames, parsed.options);
  const checker = program.getTypeChecker();

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || sf.fileName.includes('/node_modules/'))
      continue;

    const visit = (node) => {
      if (ts.isNewExpression(node) && node.expression.getText(sf) === 'URL') {
        const arg = node.arguments?.[0];
        if (arg) {
          const brand = brandOf(checker.getTypeAtLocation(arg), checker);
          if (brand) {
            const { line } = sf.getLineAndCharacterOfPosition(
              node.getStart(sf),
            );
            const kind =
              brand === '__riBrand'
                ? 'RealmIdentifier'
                : 'RealmResourceIdentifier';
            console.log(
              `${relative(process.cwd(), sf.fileName)}:${line + 1}  ${kind}  new URL(${arg.getText(sf).slice(0, 60)})`,
            );
            total++;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

console.log(`\n${total} site(s) constructing a URL from a realm identifier.`);
