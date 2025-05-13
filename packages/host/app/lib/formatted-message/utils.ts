import { SafeString, htmlSafe } from '@ember/template';

import { unescapeHtml } from '@cardstack/runtime-common/helpers/html';

import {
  isCompleteSearchReplaceBlock,
  parseSearchReplace,
} from '../search-replace-block-parsing';

export function extractCodeData(
  preElementString: string,
  roomId: string,
  eventId: string,
  codeBlockIndex: number,
): CodeData {
  console.log(
    'extractCodeData',
    preElementString,
    roomId,
    eventId,
    codeBlockIndex,
  );
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
      code: null,
      language: null,
      searchReplaceBlock: null,
      roomId: null,
      eventId: null,
      codeBlockIndex: -1,
    };
  }

  let language = preElement.getAttribute('data-code-language') || 'text';

  let content = preElement.innerHTML;
  // Decode HTML entities to handle special characters like < and >
  content = unescapeHtml(content);
  let parsedContent = parseSearchReplace(content);

  // Transform the incomplete search/replace block into a format for streaming,
  // so that the user can see the search replace block in a human friendly format.
  // // existing code ...
  // SEARCH BLOCK
  // // new code ...
  // REPLACE BLOCK
  let adjustedContentForStreamedContentInMonacoEditor = '';
  if (parsedContent.searchContent) {
    // get count of leading spaces in the first line of searchContent
    let firstLine = parsedContent.searchContent.split('\n')[0];
    let leadingSpaces = firstLine.match(/^\s+/)?.[0]?.length ?? 0;
    let emptyString = ' '.repeat(leadingSpaces);
    adjustedContentForStreamedContentInMonacoEditor = `// existing code ... \n\n${parsedContent.searchContent.replace(
      new RegExp(emptyString, 'g'),
      '',
    )}`;

    if (parsedContent.replaceContent) {
      adjustedContentForStreamedContentInMonacoEditor += `\n\n// new code ... \n\n${parsedContent.replaceContent.replace(
        new RegExp(emptyString, 'g'),
        '',
      )}`;
    }
  }

  const lines = content.split('\n');

  let fileUrl: string | null = null;
  const fileUrlIndex = lines.findIndex((line) =>
    line.startsWith('// File url: '),
  );
  if (fileUrlIndex !== -1) {
    fileUrl = lines[fileUrlIndex].substring('// File url: '.length).trim();
  }

  let contentWithoutFileUrl;
  if (fileUrl) {
    contentWithoutFileUrl = lines.slice(fileUrlIndex + 1).join('\n');
  }

  tempContainer.remove();
  return {
    language: language ?? '',
    code: adjustedContentForStreamedContentInMonacoEditor || content,
    fileUrl,
    searchReplaceBlock: isCompleteSearchReplaceBlock(contentWithoutFileUrl)
      ? contentWithoutFileUrl
      : null,
    roomId,
    eventId,
    codeBlockIndex,
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

export interface CodeData {
  fileUrl: string | null;
  code: string | null;
  language: string | null;
  searchReplaceBlock?: string | null;
  roomId: string | null;
  eventId: string | null;
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
        result.push({
          type: 'pre_tag',
          content: element.outerHTML,
          codeData: extractCodeData(
            element.outerHTML,
            roomId,
            eventId,
            codeBlockIndex++,
          ),
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
