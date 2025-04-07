import { SafeString, htmlSafe } from '@ember/template';

import { CodeData } from '@cardstack/host/components/ai-assistant/formatted-message';

import {
  isCompleteSearchReplaceBlock,
  parseSearchReplace,
} from '../search-replace-block-parsing';

function findMatchingClosingTag(str: string, startPos: number): number {
  let nestLevel = 1;
  let pos = startPos;

  while (nestLevel > 0 && pos < str.length) {
    let openTag = str.indexOf('<pre', pos);
    let closeTag = str.indexOf('</pre>', pos);

    if (closeTag === -1) return -1;

    if (openTag !== -1 && openTag < closeTag) {
      nestLevel++;
      pos = openTag + 4;
    } else {
      nestLevel--;
      pos = closeTag + 6;
      if (nestLevel === 0) {
        return closeTag;
      }
    }
  }
  return -1;
}

export function extractCodeData(preElementString: string): CodeData {
  // Find the opening pre tag
  let openTagEnd = preElementString.indexOf('>');
  if (openTagEnd === -1) {
    return {
      fileUrl: null,
      code: null,
      language: null,
      searchReplaceBlock: null,
    };
  }

  // Find the matching closing tag considering nesting
  let closingTagStart = findMatchingClosingTag(preElementString, openTagEnd);
  if (closingTagStart === -1) {
    return {
      fileUrl: null,
      code: null,
      language: null,
      searchReplaceBlock: null,
    };
  }

  let content = preElementString.slice(openTagEnd + 1, closingTagStart);
  let language = null;
  let languageMatch = preElementString.match(/data-code-language="([^"]+)"/);
  if (languageMatch) {
    language = languageMatch[1];
  }

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
