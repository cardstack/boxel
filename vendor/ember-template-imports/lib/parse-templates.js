'use strict';
var __importDefault =
  (this && this.__importDefault) ||
  function (mod) {
    return mod && mod.__esModule ? mod : { default: mod };
  };
Object.defineProperty(exports, '__esModule', { value: true });
exports.parseTemplates = void 0;
const string_prototype_matchall_1 = __importDefault(
  require('string.prototype.matchall'),
);
const debug_1 = require('./debug');
const escapeChar = '\\';
const stringDelimiter = /['"]/;
const singleLineCommentStart = /\/\//;
const newLine = /\n/;
const multiLineCommentStart = /\/\*/;
const multiLineCommentEnd = /\*\//;
const templateLiteralStart = /([$a-zA-Z_][0-9a-zA-Z_$]*)?`/;
const templateLiteralEnd = /`/;
const dynamicSegmentStart = /\${/;
const blockStart = /{/;
const dynamicSegmentEnd = /}/;
function isEscaped(template, _offset) {
  let offset = (0, debug_1.expect)(
    _offset,
    'Expected an index to check escaping',
  );
  let count = 0;
  while (template[offset - 1] === escapeChar) {
    count++;
    offset--;
  }
  return count % 2 === 1;
}
/**
 * Parses a template to find all possible valid matches for an embedded template.
 * Supported syntaxes are template literals:
 *
 *   hbs`Hello, world!`
 *
 * And template tags
 *
 *   <template></template>
 *
 * The parser excludes any values found within strings recursively, and also
 * excludes any string literals with dynamic segments (e.g `${}`) since these
 * cannot be valid templates.
 *
 * @param template The template to parse
 * @param relativePath Relative file path for the template (for errors)
 * @param templateTag Optional template tag if parsing template tags is enabled
 * @returns
 */
function parseTemplates(template, relativePath, templateTag) {
  const results = [];
  const templateTagStart = new RegExp(`<${templateTag}[^<]*>`);
  const templateTagEnd = new RegExp(`</${templateTag}>`);
  const argumentsMatchRegex = new RegExp(`<${templateTag}[^<]*\\S[^<]*>`);
  const allTokens = new RegExp(
    [
      singleLineCommentStart.source,
      newLine.source,
      multiLineCommentStart.source,
      multiLineCommentEnd.source,
      stringDelimiter.source,
      templateLiteralStart.source,
      templateLiteralEnd.source,
      dynamicSegmentStart.source,
      dynamicSegmentEnd.source,
      blockStart.source,
      templateTagStart.source,
      templateTagEnd.source,
    ].join('|'),
    'g',
  );
  const tokens = Array.from(
    (0, string_prototype_matchall_1.default)(template, allTokens),
  );
  while (tokens.length > 0) {
    const currentToken = tokens.shift(); // eslint-disable-line @typescript-eslint/no-non-null-assertion
    parseToken(results, template, currentToken, tokens, true);
  }
  /**
   * Parse the current token. If top level, then template tags can be parsed.
   * Else, we are nested within a dynamic segment, which is currently unsupported.
   */
  function parseToken(results, template, token, tokens, isTopLevel = false) {
    if (token[0].match(multiLineCommentStart)) {
      parseMultiLineComment(results, template, token, tokens);
    } else if (token[0].match(singleLineCommentStart)) {
      parseSingleLineComment(results, template, token, tokens);
    } else if (token[0].match(templateLiteralStart)) {
      parseTemplateLiteral(results, template, token, tokens, isTopLevel);
    } else if (
      isTopLevel &&
      templateTag !== undefined &&
      templateTagStart &&
      token[0].match(templateTagStart)
    ) {
      parseTemplateTag(results, template, token, tokens);
    } else if (token[0].match(stringDelimiter)) {
      parseString(results, template, token, tokens);
    }
  }
  /**
   * Parse a string. All tokens within a string are ignored
   * since there are no dynamic segments within these.
   */
  function parseString(_results, template, startToken, tokens) {
    while (tokens.length > 0) {
      const currentToken = (0, debug_1.expect)(
        tokens.shift(),
        'expected token',
      );
      if (
        currentToken[0] === startToken[0] &&
        !isEscaped(template, currentToken.index)
      ) {
        return;
      }
    }
  }
  /**
   * Parse a string or a regex. All tokens within a string or regex are ignored
   * since there are no dynamic segments within these.
   */
  function parseSingleLineComment(_results, _template, _startToken, tokens) {
    while (tokens.length > 0) {
      const currentToken = (0, debug_1.expect)(
        tokens.shift(),
        'expected token',
      );
      if (currentToken[0] === '\n') {
        return;
      }
    }
  }
  /**
   * Parse a string or a regex. All tokens within a string or regex are ignored
   * since there are no dynamic segments within these.
   */
  function parseMultiLineComment(_results, _template, _startToken, tokens) {
    while (tokens.length > 0) {
      const currentToken = (0, debug_1.expect)(
        tokens.shift(),
        'expected token',
      );
      if (currentToken[0] === '*/') {
        return;
      }
    }
  }
  /**
   * Parse a template literal. If a dynamic segment is found, enters the dynamic
   * segment and parses it recursively. If no dynamic segments are found and the
   * literal is top level (e.g. not nested within a dynamic segment) and has a
   * tag, pushes it into the list of results.
   */
  function parseTemplateLiteral(
    results,
    template,
    startToken,
    tokens,
    isTopLevel = false,
  ) {
    var _a;
    let hasDynamicSegment = false;
    while (tokens.length > 0) {
      let currentToken = (0, debug_1.expect)(tokens.shift(), 'expected token');
      if (isEscaped(template, currentToken.index)) continue;
      if (currentToken[0].match(dynamicSegmentStart)) {
        hasDynamicSegment = true;
        parseDynamicSegment(results, template, currentToken, tokens);
      } else if (currentToken[0].match(templateLiteralEnd)) {
        if (
          isTopLevel &&
          !hasDynamicSegment &&
          ((_a = startToken[1]) === null || _a === void 0
            ? void 0
            : _a.length) > 0
        ) {
          // Handle the case where a tag-like was matched, e.g. hbs`hello`
          if (currentToken[0].length > 1) {
            const tokenStr = currentToken[0];
            const index = (0, debug_1.expect)(
              currentToken.index,
              'expected index',
            );
            currentToken = ['`'];
            currentToken.index = index + tokenStr.length - 1;
          }
          results.push({
            type: 'template-literal',
            tagName: startToken[1],
            start: startToken,
            end: currentToken,
          });
        }
        return;
      }
    }
  }
  /**
   * Parses a dynamic segment within a template literal. Continues parsing until
   * the dynamic segment has been exited, ignoring all tokens within it.
   * Accounts for nested block statements, strings, and template literals.
   */
  function parseDynamicSegment(results, template, _startToken, tokens) {
    let stack = 1;
    while (tokens.length > 0) {
      const currentToken = (0, debug_1.expect)(
        tokens.shift(),
        'expected token',
      );
      if (currentToken[0].match(blockStart)) {
        stack++;
      } else if (currentToken[0].match(dynamicSegmentEnd)) {
        stack--;
      } else {
        parseToken(results, template, currentToken, tokens);
      }
      if (stack === 0) {
        return;
      }
    }
  }
  /**
   * Parses a template tag. Continues parsing until the template tag has closed,
   * accounting for nested template tags.
   */
  function parseTemplateTag(results, _template, startToken, tokens) {
    let stack = 1;
    if (argumentsMatchRegex && startToken[0].match(argumentsMatchRegex)) {
      throw new Error(
        `embedded template preprocessing currently does not support passing arguments, found args in: ${relativePath}`,
      );
    }
    while (tokens.length > 0) {
      const currentToken = (0, debug_1.expect)(
        tokens.shift(),
        'expected token',
      );
      if (currentToken[0].match(templateTagStart)) {
        stack++;
      } else if (currentToken[0].match(templateTagEnd)) {
        stack--;
      }
      if (stack === 0) {
        results.push({
          type: 'template-tag',
          start: startToken,
          end: currentToken,
        });
        return;
      }
    }
  }
  return results;
}
exports.parseTemplates = parseTemplates;
