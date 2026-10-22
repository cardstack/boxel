import type { SafeString } from '@ember/template';
import { htmlSafe } from '@ember/template';

import { unescapeHtml } from '@cardstack/runtime-common/helpers/html';

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
      code: null,
      language: null,
      roomId: '',
      eventId: '',
      codeBlockIndex: -1,
    };
  }

  let language = preElement.getAttribute('data-code-language') || 'text';

  // Decode HTML entities to handle special characters like < and >
  let content = unescapeHtml(preElement.innerHTML);
  tempContainer.remove();

  return {
    language,
    code: content,
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
  code: string | null;
  language: string | null;
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
