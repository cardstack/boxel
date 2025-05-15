import { SafeString, htmlSafe } from '@ember/template';

import { unescapeHtml } from '@cardstack/runtime-common/helpers/html';

import { CodeData } from '@cardstack/host/components/ai-assistant/formatted-message';

import {
  isCompleteSearchReplaceBlock,
  parseSearchReplace,
} from '../search-replace-block-parsing';

export function extractCodeData(preElementString: string): CodeData {
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
      codeBlockMeta: null,
      code: null,
      language: null,
      searchReplaceBlock: null,
    };
  }

  let language = preElement.getAttribute('data-code-language') || 'text';
  let content = preElement.innerHTML;
  tempContainer.remove();

  // Decode HTML entities to handle special characters like < and >
  content = unescapeHtml(content);
  let parsedContent = parseSearchReplace(content);

  // Transform the incomplete search/replace block into a format for streaming,
  // so that the user can see the search replace block in a human friendly format, like this:
  // // existing code ...
  // <SEARCH BLOCK>
  // // new code ...
  // <REPLACE BLOCK>
  // The above will only be shown until the search/replace block is complete (while streaming)
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

  // Before SEARCH/REPLACE block, there will be a line with the file url
  // (editing a file) or file name (creating a new file).
  // The code that follows will try to parse the file url or file name, and
  // hide it from the user as it streams because it's not actually part of
  // the code block, and it's confusing to show it.

  let lines = content.split('\n');

  let fileUrlOrFileName: string | undefined = undefined;
  let fileUrl: string | undefined = undefined;
  let fileName: string | undefined = undefined;
  let isBeginningOfSearchReplaceBlock =
    lines.length > 1 && lines[1].startsWith('<<<<<<<');

  if (isBeginningOfSearchReplaceBlock) {
    fileUrlOrFileName = lines[0];
    if (fileUrlOrFileName.match(/^https?:\/\//)) {
      fileUrl = fileUrlOrFileName;
    } else {
      fileName = fileUrlOrFileName;
    }
  }

  let firstLineIsUrlOrFileName =
    lines.length == 1 &&
    (lines[0].startsWith('http') || lines[0].match(/\.[a-zA-Z0-9]+$/));

  let codeToDisplay = '';
  if (
    firstLineIsUrlOrFileName ||
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

  return {
    language: language ?? '',
    code: codeToDisplay,
    codeBlockMeta: {
      fileUrl: fileUrl ?? null,
      fileName: fileName ?? null,
      isNewFile: Boolean(fileName && !fileUrl),
    },
    searchReplaceBlock: isCompleteSearchReplaceBlock(contentWithoutFirstLine)
      ? contentWithoutFirstLine
      : null,
  };
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

export interface HtmlTagGroup {
  type: 'pre_tag' | 'non_pre_tag';
  content: string;
}

export function parseHtmlContent(htmlString: string): HtmlTagGroup[] {
  let result: HtmlTagGroup[] = [];

  // Create a temporary DOM element to parse the HTML string.
  // This approach allows us to:
  // 1. Properly identify and separate pre and non-pre tags
  // 2. Handle nested HTML structures correctly
  // 3. Preserve the original HTML structure of each tag
  let doc = document.createElement('div');
  doc.innerHTML = htmlString;

  Array.from(doc.childNodes).forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      let textContent = node.textContent?.trim() || '';
      if (textContent) {
        result.push({
          type: 'non_pre_tag',
          content: textContent,
        });
      }
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      let element = node as HTMLElement;
      let tagName = element.tagName.toLowerCase();

      if (tagName === 'pre') {
        result.push({
          type: 'pre_tag',
          content: element.outerHTML,
        });
      } else {
        result.push({
          type: 'non_pre_tag',
          content: element.outerHTML,
        });
      }
    }
  });

  doc.remove();
  return result;
}
