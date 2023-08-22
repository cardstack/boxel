'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.preprocessEmbeddedTemplates = void 0;
const magic_string_1 = __importDefault(require('magic-string'));
const path_1 = __importDefault(require('path'));
const parse_static_imports_1 = __importDefault(require('parse-static-imports'));
const line_column_1 = __importDefault(require('line-column'));
const debug_1 = require('./debug');
const parse_templates_1 = require('./parse-templates');
function getMatchStartAndEnd(match) {
  return {
    start: (0, debug_1.expect)(
      match.index,
      'Expected regular expression match to have an index',
    ),
    end:
      (0, debug_1.expect)(
        match.index,
        'Expected regular expression match to have an index',
      ) + match[0].length,
  };
}
function findImportedName(template, importPath, importIdentifier) {
  for (const $import of (0, parse_static_imports_1.default)(template)) {
    if ($import.moduleName === importPath) {
      const match = $import.namedImports.find(
        ({ name }) => name === importIdentifier,
      );
      return (
        (match === null || match === void 0 ? void 0 : match.alias) ||
        (match === null || match === void 0 ? void 0 : match.name)
      );
    }
  }
  return undefined;
}
function replacementFrom(template, index, oldLength, newLength, type) {
  const loc = (0, debug_1.expect)(
    (0, line_column_1.default)(template).fromIndex(index),
    'BUG: expected to find a line/column based on index',
  );
  return {
    type,
    index,
    oldLength,
    newLength,
    originalCol: loc.col,
    originalLine: loc.line,
  };
}
function loadGetTemplateLocals(path, exportPath) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const templateLocals = require(path);
  let getTemplateLocals = templateLocals;
  for (const segment of exportPath.split('.')) {
    getTemplateLocals = getTemplateLocals[segment];
  }
  return getTemplateLocals;
}
function replaceMatch(
  s,
  match,
  startReplacement,
  endReplacement,
  template,
  getTemplateLocals,
  includeTemplateTokens,
) {
  const { start: openStart, end: openEnd } = getMatchStartAndEnd(match.start);
  const { start: closeStart, end: closeEnd } = getMatchStartAndEnd(match.end);
  let options = '';
  if (includeTemplateTokens) {
    const tokensString = getTemplateLocals(template.slice(openEnd, closeStart))
      .filter((local) => local.match(/^[$A-Z_][0-9A-Z_$]*$/i))
      .join(',');
    if (tokensString.length > 0) {
      options = `, scope: () => ({${tokensString}})`;
    }
  }
  const newStart = `${startReplacement}\``;
  const newEnd = `\`, { strictMode: true${options} }${endReplacement}`;
  s.overwrite(openStart, openEnd, newStart);
  s.overwrite(closeStart, closeEnd, newEnd);
  return [
    replacementFrom(
      template,
      openStart,
      openEnd - openStart,
      newStart.length,
      'start',
    ),
    replacementFrom(
      template,
      closeStart,
      closeEnd - closeStart,
      newEnd.length,
      'end',
    ),
  ];
}
/**
 * Preprocesses all embedded templates within a JavaScript or TypeScript file.
 * This function replaces all embedded templates that match our template syntax
 * with valid, parseable JS. Optionally, it can also include a source map, and
 * it can also include all possible values used within the template.
 *
 * Input:
 *
 *   <template><MyComponent/><template>
 *
 * Output:
 *
 *   [GLIMMER_TEMPLATE(`<MyComponent/>`, { scope() { return {MyComponent}; } })];
 *
 * It can also be used with template literals to provide the in scope values:
 *
 * Input:
 *
 *   hbs`<MyComponent/>`;
 *
 * Output
 *
 *   hbs(`<MyComponent/>`, { scope() { return {MyComponent}; } });
 */
function preprocessEmbeddedTemplates(template, options) {
  let getTemplateLocals;
  const {
    importPath,
    templateTag,
    templateTagReplacement,
    includeSourceMaps,
    includeTemplateTokens,
    relativePath,
  } = options;
  let { importIdentifier } = options;
  if ('getTemplateLocals' in options) {
    getTemplateLocals = options.getTemplateLocals;
  } else {
    getTemplateLocals = loadGetTemplateLocals(
      options.getTemplateLocalsRequirePath,
      options.getTemplateLocalsExportPath,
    );
  }
  if (importPath && importIdentifier) {
    importIdentifier = findImportedName(template, importPath, importIdentifier);
    if (!importIdentifier) {
      return {
        output: template,
        replacements: [],
      };
    }
  }
  const matches = (0, parse_templates_1.parseTemplates)(
    template,
    relativePath,
    templateTag,
  );
  const replacements = [];
  const s = new magic_string_1.default(template);
  for (const match of matches) {
    if (
      match.type === 'template-literal' &&
      match.tagName === importIdentifier
    ) {
      replacements.push(
        ...replaceMatch(
          s,
          match,
          `${match.tagName}(`,
          ')',
          template,
          getTemplateLocals,
          includeTemplateTokens,
        ),
      );
    } else if (match.type === 'template-tag') {
      replacements.push(
        ...replaceMatch(
          s,
          match,
          `[${templateTagReplacement}(`,
          ')]',
          template,
          getTemplateLocals,
          includeTemplateTokens,
        ),
      );
    }
  }
  let output = s.toString();
  if (includeSourceMaps) {
    const { dir, name } = path_1.default.parse(relativePath);
    const map = s.generateMap({
      file: `${dir}/${name}.js`,
      source: relativePath,
      includeContent: true,
      hires: true,
    });
    output += `\n//# sourceMappingURL=${map.toUrl()}`;
  }
  return {
    output,
    replacements,
  };
}
exports.preprocessEmbeddedTemplates = preprocessEmbeddedTemplates;
