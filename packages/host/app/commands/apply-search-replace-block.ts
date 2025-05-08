import type * as BaseCommandModule from 'https://cardstack.com/base/command';

import HostBaseCommand from '../lib/host-base-command';

export default class ApplySearchReplaceBlockCommand extends HostBaseCommand<
  typeof BaseCommandModule.ApplySearchReplaceBlockInput,
  typeof BaseCommandModule.ApplySearchReplaceBlockResult
> {
  description = `Apply search/replace blocks to file contents. The format is:
<<<<<<< SEARCH
[original code to find]
=======
[new code to replace with]
>>>>>>> REPLACE
`;

  async getInputType() {
    let commandModule = await this.loadCommandModule();
    const { ApplySearchReplaceBlockInput } = commandModule;
    return ApplySearchReplaceBlockInput;
  }

  protected async run(
    input: BaseCommandModule.ApplySearchReplaceBlockInput,
  ): Promise<BaseCommandModule.ApplySearchReplaceBlockResult> {
    let commandModule = await this.loadCommandModule();
    const { ApplySearchReplaceBlockResult } = commandModule;

    // Parse the search and replace blocks from the provided code block
    const { searchPattern, replacePattern } = this.parseCodeBlock(
      input.codeBlock,
    );

    if (searchPattern == null) {
      throw new Error("Can't parse SEARCH block");
    } else if (replacePattern == null) {
      throw new Error("Can't parse REPLACE block");
    }

    // Apply the search/replace operation
    const resultContent = this.applySearchReplace(
      input.fileContent,
      searchPattern,
      replacePattern,
    );

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
    const searchMarker = '<<<<<<< SEARCH';
    const dividerMarker = '=======';
    const replaceMarker = '>>>>>>> REPLACE';

    // Make sure the code block has all the required markers
    if (
      !codeBlock.includes(searchMarker) ||
      !codeBlock.includes(dividerMarker) ||
      !codeBlock.includes(replaceMarker)
    ) {
      return { searchPattern: null, replacePattern: null };
    }

    // Extract the search and replace patterns
    const searchStart = codeBlock.indexOf(searchMarker) + searchMarker.length;
    const dividerPos = codeBlock.indexOf(dividerMarker);
    const replaceStart = dividerPos + dividerMarker.length;
    const replaceEnd = codeBlock.indexOf(replaceMarker);

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

    return {
      searchPattern,
      replacePattern: replacePatternWithoutLeadingNewline.replace(/\n$/, ''),
    };
  }

  /**
   * Apply search and replace operation, handling whitespace variations
   */
  private applySearchReplace(
    content: string,
    searchPattern: string,
    replacePattern: string,
  ): string {
    // Create a normalized search pattern for matching
    // This helps with whitespace differences
    const normalizedSearchLines = searchPattern
      .split('\n')
      .map((line) => line.trim());

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

    return resultLines.join('\n');
  }

  /**
   * Find a match for the search pattern in content lines starting from startIndex
   */
  private findMatch(
    contentLines: string[],
    startIndex: number,
    normalizedSearchLines: string[],
  ): { matched: boolean; matchLength: number } {
    // Make sure we have enough lines to match
    if (startIndex + normalizedSearchLines.length > contentLines.length) {
      return { matched: false, matchLength: 0 };
    }

    // Check if the pattern matches line by line
    let searchLineIndex = 0;
    let contentLineIndex = startIndex;
    while (searchLineIndex < normalizedSearchLines.length) {
      const contentLine = contentLines[contentLineIndex].trim();
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
