import { SafeString, htmlSafe } from '@ember/template';

import { CodeData } from '@cardstack/host/components/ai-assistant/formatted-message';

import {
  isCompleteSearchReplaceBlock,
  parseSearchReplace,
} from '../search-replace-block-parsing';

export function extractCodeData(preElementString: string): CodeData {
  let tempContainer = document.createElement('div');
  tempContainer.innerHTML = preElementString;
  let preElement = tempContainer.querySelector('pre');

  if (!preElement) {
    return {
      fileUrl: null,
      code: null,
      language: null,
      searchReplaceBlock: null,
    };
  }

  let language = preElement.getAttribute('data-code-language') || 'text';

  let content = preElement.innerHTML;
  // Decode HTML entities to handle special characters like < and >
  let textarea = document.createElement('textarea');
  textarea.innerHTML = content;
  content = textarea.value;
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

  return {
    language: language ?? '',
    code: adjustedContentForStreamedContentInMonacoEditor || content,
    fileUrl,
    searchReplaceBlock: isCompleteSearchReplaceBlock(contentWithoutFileUrl)
      ? contentWithoutFileUrl
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

  return result;
}
