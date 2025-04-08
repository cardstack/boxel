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

  let language = preElement.getAttribute('data-code-language') || null;

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
  let tagStack: { tag: string; startPos: number }[] = [];
  let currentPosition = 0;

  let findNextTag = (
    pos: number,
  ): { type: 'open' | 'close'; tag: string; position: number } | null => {
    // Match either:
    // 1. Opening tag: <tag> or <tag attr="value">
    // 2. Closing tag: </tag>
    let tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)\s*(?:[^>]*?)>/g;
    tagPattern.lastIndex = pos;

    let match = tagPattern.exec(htmlString);
    if (!match) return null;

    return {
      type: match[0].startsWith('</') ? 'close' : 'open',
      tag: match[1].toLowerCase(),
      position: match.index,
    };
  };

  while (currentPosition < htmlString.length) {
    let nextTag = findNextTag(currentPosition);

    if (!nextTag) {
      if (tagStack.length === 0) {
        let remaining = htmlString.slice(currentPosition).trim();
        if (remaining) {
          result.push({
            type: 'non_pre_tag',
            content: remaining,
          });
        }
      }
      break;
    }

    if (nextTag.type === 'open') {
      tagStack.push({ tag: nextTag.tag, startPos: nextTag.position });
      currentPosition = nextTag.position + 1;
    } else {
      if (
        tagStack.length > 0 &&
        tagStack[tagStack.length - 1].tag === nextTag.tag
      ) {
        let openTag = tagStack.pop()!;

        if (tagStack.length === 0) {
          let content = htmlString.slice(
            openTag.startPos,
            nextTag.position + nextTag.tag.length + 3,
          );
          result.push({
            type: nextTag.tag === 'pre' ? 'pre_tag' : 'non_pre_tag',
            content: content,
          });
        }
        currentPosition = nextTag.position + nextTag.tag.length + 3;
      } else {
        currentPosition = nextTag.position + 1;
      }
    }
  }

  return result;
}
