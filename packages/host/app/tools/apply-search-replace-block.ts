import {
  findSearchReplaceBlock,
  stripTrailingSeparatorMarker,
} from '@cardstack/runtime-common';

import HostBaseTool from '../lib/host-base-tool';

import type * as BaseToolModule from '@cardstack/base/command';

let standardErrorMessage =
  'Unable to process the code patch due to invalid code coming from AI';
export const APPLY_SEARCH_REPLACE_BLOCK_ERROR_MESSAGES = {
  SEARCH_BLOCK_PARSE_ERROR: `${standardErrorMessage} (search block parse error)`,
  REPLACE_BLOCK_PARSE_ERROR: `${standardErrorMessage} (replace block parse error)`,
  SEARCH_PATTERN_NOT_FOUND: `${standardErrorMessage} (search pattern not found in the target source file)`,
  EMPTY_SEARCH_PATTERN_ON_NONEMPTY_FILE: `${standardErrorMessage} (empty search pattern for non-empty file)`,
} as const;

type LineNormalizer = (line: string) => string;

const trimLine: LineNormalizer = (line) => line.trim();
const trimLineAndTrailingComma: LineNormalizer = (line) =>
  line.trim().replace(/,$/, '');

// Search lines are compared to file lines under a normalization per line,
// and matching is tried in two passes. Indentation never has to match. The
// first pass compares every line trimmed. The second pass also ignores a
// trailing comma, on the block's last non-empty line only: a model writing
// a JSON or object-literal search block from memory routinely ends it with
// `}` where the file has `},` because another key follows, and that single
// character is the most common reason an otherwise correct block fails to
// apply. Lines before the last keep the exact comparison. Relaxing them too
// would let a block whose internal commas are wrong match the file, and the
// replacement, written with the same wrong commas, would break the file
// silently where a reported failure was the safe outcome.
//
// When only the second pass matches, the replacement's last line is given
// the file's trailing comma (or relieved of one), but only when the model
// wrote search and replace with the same comma state, which says it did not
// mean to change it. Writing the replacement verbatim there would turn the
// file's `},` into `}` and break the JSON the patch set out to fix.
function lastNonEmptyLineIndex(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== '') {
      return i;
    }
  }
  return -1;
}

function exactNormalizers(searchLines: string[]): LineNormalizer[] {
  return searchLines.map(() => trimLine);
}

function trailingCommaNormalizers(searchLines: string[]): LineNormalizer[] {
  let lastIndex = lastNonEmptyLineIndex(searchLines);
  return searchLines.map((_line, index) =>
    index === lastIndex ? trimLineAndTrailingComma : trimLine,
  );
}

const MATCHING_PASSES: {
  normalizersFor: (searchLines: string[]) => LineNormalizer[];
  reconcileTrailingComma: boolean;
}[] = [
  { normalizersFor: exactNormalizers, reconcileTrailingComma: false },
  { normalizersFor: trailingCommaNormalizers, reconcileTrailingComma: true },
];

function endsWithComma(line: string | undefined): boolean {
  return line !== undefined && line.trim().endsWith(',');
}

// The bare "not found" message gives the model nothing to correct, so it
// tends to resend the same block. Naming the first search line that occurs
// nowhere in the file points at the line to fix; when every line occurs
// somewhere, the lines exist but not in this order or adjacency. Each line
// is looked up under the loosest normalization the matcher applies to it, so
// the message never names a line the matcher would have accepted.
export function describeSearchPatternNotFound(
  fileContent: string,
  searchPattern: string,
): string {
  let fileLines = fileContent.split('\n');
  let searchLines = searchPattern.split('\n');
  let normalizers = trailingCommaNormalizers(searchLines);
  let missingLine = searchLines.find((line, index) => {
    let normalize = normalizers[index];
    let normalizedLine = normalize(line);
    return (
      normalizedLine !== '' &&
      !fileLines.some((fileLine) => normalize(fileLine) === normalizedLine)
    );
  });
  if (missingLine !== undefined) {
    return `${APPLY_SEARCH_REPLACE_BLOCK_ERROR_MESSAGES.SEARCH_PATTERN_NOT_FOUND}. The first search line that does not appear anywhere in the file: ${missingLine.trim()}`;
  }
  return `${APPLY_SEARCH_REPLACE_BLOCK_ERROR_MESSAGES.SEARCH_PATTERN_NOT_FOUND}. Every search line appears somewhere in the file, but not as one contiguous run in this order.`;
}

export default class ApplySearchReplaceBlockTool extends HostBaseTool<
  typeof BaseToolModule.ApplySearchReplaceBlockInput,
  typeof BaseToolModule.ApplySearchReplaceBlockResult
> {
  description = `Apply search/replace blocks to file contents. The format is:
╔═══ SEARCH ════╗
[original code to find]
╠═══════════════╣
[new code to replace with]
╚═══ REPLACE ═══╝
`;
  static actionVerb = 'Apply';

  async getInputType() {
    let commandModule = await this.loadToolModule();
    const { ApplySearchReplaceBlockInput } = commandModule;
    return ApplySearchReplaceBlockInput;
  }

  requireInputFields = ['codeBlock', 'fileContent'];

  protected async run(
    input: BaseToolModule.ApplySearchReplaceBlockInput,
  ): Promise<BaseToolModule.ApplySearchReplaceBlockResult> {
    let commandModule = await this.loadToolModule();
    const { ApplySearchReplaceBlockResult } = commandModule;

    // Parse the search and replace blocks from the provided code block
    const { searchPattern, replacePattern } = this.parseCodeBlock(
      input.codeBlock,
    );

    if (searchPattern == null) {
      throw new Error(
        APPLY_SEARCH_REPLACE_BLOCK_ERROR_MESSAGES.SEARCH_BLOCK_PARSE_ERROR,
      );
    } else if (replacePattern == null) {
      throw new Error(
        APPLY_SEARCH_REPLACE_BLOCK_ERROR_MESSAGES.REPLACE_BLOCK_PARSE_ERROR,
      );
    } else if (searchPattern === '' && input.fileContent.trim() !== '') {
      throw new Error(
        APPLY_SEARCH_REPLACE_BLOCK_ERROR_MESSAGES.EMPTY_SEARCH_PATTERN_ON_NONEMPTY_FILE,
      );
    }

    // Apply the search/replace operation
    const resultContent = this.applySearchReplace(
      input.fileContent,
      searchPattern,
      replacePattern,
    );
    if (resultContent === undefined) {
      throw new Error(
        describeSearchPatternNotFound(input.fileContent, searchPattern),
      );
    }

    return new ApplySearchReplaceBlockResult({
      resultContent,
    });
  }

  /**
   * Parse the code block to extract search and replace patterns
   */
  private parseCodeBlock(codeBlock: string): {
    searchPattern: string | null;
    replacePattern: string | null;
  } {
    // Make sure the code block has all the required markers, in order
    const block = findSearchReplaceBlock(codeBlock);
    if (!block) {
      return { searchPattern: null, replacePattern: null };
    }

    // Extract the search and replace patterns
    const searchStart = block.search.end;
    const dividerPos = block.separator.index;
    const replaceStart = block.separator.end;
    const replaceEnd = block.replace.index;

    if (searchStart >= dividerPos || replaceStart >= replaceEnd) {
      return { searchPattern: null, replacePattern: null };
    }

    // Extract search pattern (trim for comparison) and replace pattern (preserve exactly)
    const searchPattern = codeBlock.substring(searchStart, dividerPos).trim();
    const replacePattern = codeBlock.substring(replaceStart, replaceEnd);
    // remove leading newline from replace pattern
    const replacePatternWithoutLeadingNewline = replacePattern.replace(
      /^[\n\r]*/,
      '',
    );
    // A malformed block can carry a stray extra separator line right before the
    // REPLACE marker; without this it would be written into the file verbatim.
    const replacePatternWithoutStraySeparator = stripTrailingSeparatorMarker(
      replacePatternWithoutLeadingNewline,
    );

    return {
      searchPattern,
      replacePattern: replacePatternWithoutStraySeparator.replace(/\n$/, ''),
    };
  }

  /**
   * Apply search and replace operation, handling whitespace variations.
   * Returns undefined when the search pattern is not found.
   */
  private applySearchReplace(
    content: string,
    searchPattern: string,
    replacePattern: string,
  ): string | undefined {
    if (searchPattern === '') {
      return replacePattern;
    }
    // Each pass compares lines under a looser normalization than the one
    // before it, and the first pass that matches wins, so a block that
    // matches exactly is never redirected to a looser match elsewhere.
    for (const { normalizersFor, reconcileTrailingComma } of MATCHING_PASSES) {
      const result = this.applySearchReplaceWith(
        content,
        searchPattern,
        replacePattern,
        normalizersFor,
        reconcileTrailingComma,
      );
      if (result !== undefined) {
        return result;
      }
    }
    return undefined;
  }

  private applySearchReplaceWith(
    content: string,
    searchPattern: string,
    replacePattern: string,
    normalizersFor: (searchLines: string[]) => LineNormalizer[],
    reconcileTrailingComma: boolean,
  ): string | undefined {
    const searchLines = searchPattern.split('\n');
    const normalizers = normalizersFor(searchLines);
    const normalizedSearchLines = searchLines.map((line, index) =>
      normalizers[index](line),
    );

    // Split content into lines for line-by-line processing
    const contentLines = content.split('\n');
    const resultLines: string[] = [];

    // Process content line by line
    let i = 0;
    while (i < contentLines.length) {
      // Try to match the search pattern starting from current line
      const matchResult = this.findMatch(
        contentLines,
        i,
        normalizedSearchLines,
        normalizers,
      );

      if (matchResult.matched) {
        // We found a match
        // Split the replacement text by lines and add each line exactly as is
        const replaceLines = replacePattern.split('\n');
        if (reconcileTrailingComma && replacePattern !== '') {
          const fileLine = contentLines[i + matchResult.matchLength - 1];
          const searchLast = searchLines[lastNonEmptyLineIndex(searchLines)];
          const replaceLastIndex = lastNonEmptyLineIndex(replaceLines);
          const replaceLast = replaceLines[replaceLastIndex];
          const modelKeptComma =
            endsWithComma(searchLast) === endsWithComma(replaceLast);
          if (
            replaceLastIndex !== -1 &&
            modelKeptComma &&
            endsWithComma(fileLine) !== endsWithComma(replaceLast)
          ) {
            replaceLines[replaceLastIndex] = endsWithComma(fileLine)
              ? replaceLast.replace(/\s*$/, ',')
              : replaceLast.replace(/,\s*$/, '');
          }
        }
        for (const line of replaceLines) {
          resultLines.push(line);
        }

        // Skip the matched lines
        i += matchResult.matchLength;
        while (i < contentLines.length) {
          resultLines.push(contentLines[i]);
          i++;
        }

        // Case when replace pattern is empty (deleting code) - don't produce an uneccesary empty line at the beginning of the result
        if (replacePattern === '' && resultLines[0] === '') {
          return resultLines.slice(1).join('\n');
        }
        return resultLines.join('\n');
      } else {
        // No match, keep the original line
        resultLines.push(contentLines[i]);
        i++;
      }
    }

    return undefined;
  }

  /**
   * Find a match for the search pattern in content lines starting from startIndex
   */
  private findMatch(
    contentLines: string[],
    startIndex: number,
    normalizedSearchLines: string[],
    normalizers: LineNormalizer[],
  ): { matched: boolean; matchLength: number } {
    // Make sure we have enough lines to match
    if (startIndex + normalizedSearchLines.length > contentLines.length) {
      return { matched: false, matchLength: 0 };
    }

    // Check if the pattern matches line by line
    let searchLineIndex = 0;
    let contentLineIndex = startIndex;
    while (searchLineIndex < normalizedSearchLines.length) {
      // A file line is normalized the same way as the search line it is
      // compared to, so the relaxed pass only relaxes where it means to.
      const contentLine = normalizers[searchLineIndex](
        contentLines[contentLineIndex],
      );
      const searchLine = normalizedSearchLines[searchLineIndex];

      // Skip empty lines in the search pattern
      // as long as there are still lines in the content
      if (!searchLine && contentLine) {
        searchLineIndex++;
        continue;
      }
      // If the trimmed lines don't match, it's not a match
      if (contentLine !== searchLine && searchLine !== '') {
        return { matched: false, matchLength: 0 };
      }
      searchLineIndex++;
      contentLineIndex++;
    }

    // All lines matched. The length of the match is the size of the match in
    // the **content**, not the size of the search pattern.
    // These are often the same, but are different when the search pattern contains
    // empty lines that we skip over.
    return { matched: true, matchLength: contentLineIndex - startIndex };
  }
}

// Pre-rename spellings: realm content references these classes by named
// export in imports and codeRefs, so the old names stay importable.
export { ApplySearchReplaceBlockTool as ApplySearchReplaceBlockCommand };
