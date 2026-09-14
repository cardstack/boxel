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

// Search lines are compared to file lines under these normalizations, tried
// in order. Indentation never has to match. The second pass also ignores a
// trailing comma: a model writing a JSON or object-literal search block from
// memory routinely ends the last line with `}` where the file has `},`, and
// that single character is the most common reason an otherwise correct block
// fails to apply. Only the comparison is relaxed; the replacement is written
// exactly as the model wrote it.
const LINE_NORMALIZERS: ((line: string) => string)[] = [
  (line) => line.trim(),
  (line) => line.trim().replace(/,$/, ''),
];

// The bare "not found" message gives the model nothing to correct, so it
// tends to resend the same block. Naming the first search line that occurs
// nowhere in the file points at the line to fix; when every line occurs
// somewhere, the lines exist but not in this order or adjacency.
export function describeSearchPatternNotFound(
  fileContent: string,
  searchPattern: string,
): string {
  let fileLines = new Set(fileContent.split('\n').map((line) => line.trim()));
  let missingLine = searchPattern
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '' && !fileLines.has(line));
  if (missingLine !== undefined) {
    return `${APPLY_SEARCH_REPLACE_BLOCK_ERROR_MESSAGES.SEARCH_PATTERN_NOT_FOUND}. The first search line that does not appear anywhere in the file: ${missingLine}`;
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
    for (const normalize of LINE_NORMALIZERS) {
      const result = this.applySearchReplaceWith(
        content,
        searchPattern,
        replacePattern,
        normalize,
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
    normalize: (line: string) => string,
  ): string | undefined {
    const normalizedSearchLines = searchPattern.split('\n').map(normalize);

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
        normalize,
      );

      if (matchResult.matched) {
        // We found a match
        // Split the replacement text by lines and add each line exactly as is
        const replaceLines = replacePattern.split('\n');
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
    normalize: (line: string) => string,
  ): { matched: boolean; matchLength: number } {
    // Make sure we have enough lines to match
    if (startIndex + normalizedSearchLines.length > contentLines.length) {
      return { matched: false, matchLength: 0 };
    }

    // Check if the pattern matches line by line
    let searchLineIndex = 0;
    let contentLineIndex = startIndex;
    while (searchLineIndex < normalizedSearchLines.length) {
      const contentLine = normalize(contentLines[contentLineIndex]);
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
