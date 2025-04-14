import { SafeString, htmlSafe } from '@ember/template';

import { CodeData } from '@cardstack/host/components/ai-assistant/formatted-message';

import {
  isCompleteSearchReplaceBlock,
  parseSearchReplace,
} from '../search-replace-block-parsing';

export function extractCodeData(preElementString: string): CodeData {
  let emptyCodeData: CodeData = {
    language: null,
    fileUrl: null,
    searchReplaceBlock: null,
    code: null,
  };

  if (!preElementString) {
    return emptyCodeData;
  }

  const languageMatch = preElementString.match(
    new RegExp('data-code-language="([^"]+)"'),
  );
  const language = languageMatch ? languageMatch[1] : null;
  const contentMatch = preElementString.match(/<pre[^>]*>([\s\S]*?)<\/pre>/);
  let content = contentMatch ? contentMatch[1] : null;

  if (!content) {
    return emptyCodeData;
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

export interface HtmlTagGroup {
  type: 'pre_tag' | 'non_pre_tag';
  content: string;
}

export function parseHtmlContent(htmlString: string): HtmlTagGroup[] {
  const result: HtmlTagGroup[] = [];

  // Regular expression to match <pre> tags and their content
  const regex = /(<pre[\s\S]*?<\/pre>)|([\s\S]+?)(?=<pre|$)/g;

  let match;
  while ((match = regex.exec(htmlString)) !== null) {
    if (match[1]) {
      // This is a code block (pre tag)
      result.push({
        type: 'pre_tag',
        content: match[1],
      });
    } else if (match[2] && match[2].trim() !== '') {
      // This is non <pre> tag HTML
      result.push({
        type: 'non_pre_tag',
        content: match[2],
      });
    }
  }

  return result;
}
