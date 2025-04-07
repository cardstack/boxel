import { SafeString, htmlSafe } from '@ember/template';

import { CodeData } from '@cardstack/host/components/ai-assistant/formatted-message';

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
  if (openTagEnd === -1) return { fileUrl: null, code: null, language: null };

  // Find the matching closing tag considering nesting
  let closingTagStart = findMatchingClosingTag(preElementString, openTagEnd);
  if (closingTagStart === -1)
    return { fileUrl: null, code: null, language: null };

  // Extract the content between tags
  let content = preElementString.slice(openTagEnd + 1, closingTagStart);

  let language = null;
  let fileUrl = null;
  let searchReplaceBlock = null;

  let languageMatch = preElementString.match(/data-code-language="([^"]+)"/);
  if (languageMatch) {
    language = languageMatch[1];
  }

  let fileUrlMatch = preElementString.match(/data-file-url="([^"]+)"/);
  if (fileUrlMatch) {
    fileUrl = fileUrlMatch[1];
  }

  let searchReplaceBlockMatch = preElementString.match(
    /data-search-replace-block="([^"]+)"/,
  );
  if (searchReplaceBlockMatch) {
    searchReplaceBlock = searchReplaceBlockMatch[1];
  }

  return {
    fileUrl,
    code: content,
    language,
    searchReplaceBlock,
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
