import type { SafeString } from '@ember/template';
import { htmlSafe } from '@ember/template';

import { SEARCH_MARKER } from '@cardstack/runtime-common';
import { unescapeHtml } from '@cardstack/runtime-common/helpers/html';

import {
  isCompleteSearchReplaceBlock,
  parseSearchReplace,
} from '../search-replace-block-parsing';

import type * as _MonacoSDK from 'monaco-editor';
export function extractCodeData(
  preElementString: string,
  roomId: string,
  eventId: string,
  codeBlockIndex: number,
): CodeData {
  // We are creating a new element in the dom
  // so that we can easily parse the content of the top level <pre> tags.
  // Note that <pre> elements can have nested <pre> elements inside them and by querying the dom like that
  // it's trivial to get its contents, compared to parsing the htmlString.
  let tempContainer = document.createElement('div');
  tempContainer.innerHTML = preElementString;
  let preElement = tempContainer.querySelector('pre');

  if (!preElement) {
    tempContainer.remove();
    return {
      fileUrl: null,
      isNewFile: null,
      code: null,
      language: null,
      searchReplaceBlock: null,
      roomId: '',
      eventId: '',
      codeBlockIndex: -1,
    };
  }

  let language = preElement.getAttribute('data-code-language') || 'text';

  let content = preElement.innerHTML;
  // Decode HTML entities to handle special characters like < and >
  content = unescapeHtml(content);
  let parsedContent = parseSearchReplace(content);
  tempContainer.remove();

  // Transform the incomplete search/replace block into a format for streaming,
  // so that the user can see the search replace block in a human friendly format.
  // // existing code ...
  // SEARCH BLOCK
  // // new code ...
  // REPLACE BLOCK
  let adjustedCodeForStreamingSearchAndReplaceBlock = '';
  if (parsedContent.searchContent) {
    // get count of leading spaces in the first line of searchContent
    let firstLine = parsedContent.searchContent.split('\n')[0];
    let leadingSpaces = firstLine.match(/^\s+/)?.[0]?.length ?? 0;
    let emptyString = ' '.repeat(leadingSpaces);
    adjustedCodeForStreamingSearchAndReplaceBlock = `// existing code ... \n\n${parsedContent.searchContent.replace(
      new RegExp(emptyString, 'g'),
      '',
    )}`;

    if (parsedContent.replaceContent) {
      adjustedCodeForStreamingSearchAndReplaceBlock += `\n\n// new code ... \n\n${parsedContent.replaceContent.replace(
        new RegExp(emptyString, 'g'),
        '',
      )}`;
    }
  }

  let lines = content.split('\n');

  let fileUrl: string | undefined = undefined;
  let isBeginningOfSearchReplaceBlock =
    lines.length > 1 && lines[1].startsWith(SEARCH_MARKER.slice(0, 3));

  let isNewFile = false;

  if (isBeginningOfSearchReplaceBlock) {
    isNewFile = lines[0].endsWith('(new)');
    fileUrl = lines[0].replace(' (new)', '');
  }

  let firstLineIsUrl = lines.length == 1 && lines[0].startsWith('http');

  let codeToDisplay = '';
  if (firstLineIsUrl && lines.length === 1) {
    codeToDisplay = lines[0];
  } else if (
    firstLineIsUrl ||
    (isBeginningOfSearchReplaceBlock && !parsedContent.searchContent)
  ) {
    codeToDisplay = parsedContent.replaceContent || '';
  } else {
    codeToDisplay =
      adjustedCodeForStreamingSearchAndReplaceBlock ||
      parsedContent.replaceContent ||
      content;
  }

  let contentWithoutFirstLine = content.slice(lines[0].length).trimStart();

  if (!language || language === 'text') {
    const inferred = inferLanguageFromCode(codeToDisplay);
    if (inferred) {
      language = inferred;
    }
  }

  return {
    language: language ?? '',
    code: codeToDisplay,
    fileUrl: fileUrl ?? null,
    isNewFile,
    searchReplaceBlock: isCompleteSearchReplaceBlock(contentWithoutFirstLine)
      ? contentWithoutFirstLine
      : null,
    roomId,
    eventId,
    codeBlockIndex,
  };
}

function inferLanguageFromCode(code: string | null): string | null {
  if (!code) {
    return null;
  }

  const trimmed = code.trim();
  if (!trimmed) {
    return null;
  }

  if (/^<[^>]+>/.test(trimmed) && trimmed.includes('</')) {
    return 'html';
  }

  return null;
}

export function findLastTextNodeWithContent(parentNode: Node): Text | null {
  // iterate childNodes in reverse to find the last text node with non-whitespace text
  for (let i = parentNode.childNodes.length - 1; i >= 0; i--) {
    let child = parentNode.childNodes[i];
    if (child.textContent && child.textContent.trim() !== '') {
      if (child instanceof Text) {
        return child;
      }
      return findLastTextNodeWithContent(child);
    }
  }
  return null;
}

export function wrapLastTextNodeInStreamingTextSpan(
  html: string | SafeString,
): SafeString {
  let parser = new DOMParser();
  let doc = parser.parseFromString(html.toString(), 'text/html');
  let lastTextNode = findLastTextNodeWithContent(doc.body);
  if (lastTextNode) {
    let span = doc.createElement('span');
    span.textContent = lastTextNode.textContent;
    span.classList.add('streaming-text');
    lastTextNode.replaceWith(span);
  }
  return htmlSafe(doc.body.innerHTML);
}

export interface CodeData {
  fileUrl: string | null;
  isNewFile: boolean | null;
  code: string | null;
  language: string | null;
  searchReplaceBlock?: string | null;
  roomId: string;
  eventId: string;
  codeBlockIndex: number;
}

export type HtmlTagGroup = HtmlPreTagGroup | HtmlNonPreTagGroup;

export interface HtmlPreTagGroup {
  type: 'pre_tag';
  content: string;
  codeData: CodeData;
}

export interface HtmlNonPreTagGroup {
  type: 'non_pre_tag';
  content: string;
  codeData: null;
}

export function isHtmlPreTagGroup(
  htmlTagGroup: HtmlTagGroup,
): htmlTagGroup is HtmlPreTagGroup {
  return htmlTagGroup.type === 'pre_tag';
}

export function parseHtmlContent(
  htmlString: string,
  roomId: string,
  eventId: string,
): HtmlTagGroup[] {
  let result: HtmlTagGroup[] = [];

  // Create a temporary DOM element to parse the HTML string.
  // This approach allows us to:
  // 1. Properly identify and separate pre and non-pre tags
  // 2. Handle nested HTML structures correctly
  // 3. Preserve the original HTML structure of each tag
  let doc = document.createElement('div');
  doc.innerHTML = htmlString;

  let codeBlockIndex = 0;
  Array.from(doc.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      let textContent = node.textContent?.trim() || '';
      if (textContent) {
        result.push({
          type: 'non_pre_tag',
          content: textContent,
          codeData: null,
        });
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      let element = node as HTMLElement;
      let tagName = element.tagName.toLowerCase();

      if (tagName === 'pre') {
        let codeData = extractCodeData(
          element.outerHTML,
          roomId,
          eventId,
          codeBlockIndex++,
        );
        result.push({
          type: 'pre_tag',
          content: element.outerHTML,
          codeData,
        });
      } else {
        result.push({
          type: 'non_pre_tag',
          content: element.outerHTML,
          codeData: null,
        });
      }
    }
  });

  doc.remove();
  return result;
}

export interface CodeDiffStats {
  linesAdded: number;
  linesRemoved: number;
}

// Takes output from editor.getLineChanges() and returns the number of lines added and removed.
// This is used to display the diff stats in the code block header.
export function makeCodeDiffStats(
  lineChanges: _MonacoSDK.editor.ILineChange[] | null | undefined,
) {
  if (!lineChanges || !Array.isArray(lineChanges)) {
    return { linesAdded: 0, linesRemoved: 0 };
  }

  let linesAdded = 0;
  let linesRemoved = 0;

  lineChanges.forEach((change) => {
    const originalStart = change.originalStartLineNumber;
    const originalEnd = change.originalEndLineNumber;
    const modifiedStart = change.modifiedStartLineNumber;
    const modifiedEnd = change.modifiedEndLineNumber;

    if (originalStart === 0) {
      linesAdded += modifiedEnd - modifiedStart + 1;
    } else if (modifiedStart === 0) {
      linesRemoved += originalEnd - originalStart + 1;
    } else if (originalEnd === 0) {
      linesAdded += modifiedEnd - modifiedStart + 1;
    } else {
      linesRemoved += originalEnd - originalStart + 1;
      linesAdded += modifiedEnd - modifiedStart + 1;
    }
  });

  return { linesAdded, linesRemoved };
}
