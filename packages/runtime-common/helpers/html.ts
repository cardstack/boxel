export function isHtml(text: string): boolean {
  // Check if the text starts with an HTML tag and ends with a closing tag
  const htmlTagPattern = /^<([a-z][a-z0-9]*)\b[^>]*>[\s\S]*<\/\1>$/i;
  return htmlTagPattern.test(text.trim());
}

export function escapeHtmlTags(html: string) {
  // For example, html can be <pre><code><h1>Hello</h1></code></pre>
  // We want to escape the <h1>Hello</h1> so that it is rendered as
  // <pre><code>&lt;h1&gt;Hello&lt;/h1&gt;</code></pre>, otherwise the h1 will
  // be rendered as a real header, not code (same applies for other html tags, such as <template>, <style>, ...)
  return html.replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Example input:
// Hey can you teach mo how to use the <h1> tag? Is this correct?
// ```html
// <h1>Hello</h1>
// ```
//
// Output:
// Hey can you teach mo how to use the &lt;h1&gt; tag? Is this correct?
// ```html
// <h1>Hello</h1>
// ```
export function escapeHtmlOutsideCodeBlocks(text?: string) {
  if (text === undefined) {
    return text;
  }

  let matches = [];
  let codeBlockRegex = /`[\s\S]*?`/g;

  let match;
  while ((match = codeBlockRegex.exec(text)) !== null) {
    matches.push({
      content: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (matches.length === 0) {
    return escapeHtmlTags(text);
  }

  let result = '';
  let lastIndex = 0;

  for (let block of matches) {
    if (block.start > lastIndex) {
      let textBeforeBlock = text.substring(lastIndex, block.start);
      result += escapeHtmlTags(textBeforeBlock);
    }

    result += block.content;

    lastIndex = block.end;
  }

  // Process any text after the last code block
  if (lastIndex < text.length) {
    let textAfterLastBlock = text.substring(lastIndex);
    result += escapeHtmlTags(textAfterLastBlock);
  }

  return result;
}
