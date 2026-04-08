/**
 * ProseMirror context module — lazy-loaded via globalThis.__loadProseMirror.
 *
 * This module is the single dynamic-import entry point for ProseMirror.
 * Webpack will code-split it (and all its transitive deps) into a separate
 * chunk automatically. The base package's ProseMirrorEditor component
 * consumes the exported context object.
 */

import 'prosemirror-view/style/prosemirror.css';

import { Schema } from 'prosemirror-model';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { keymap } from 'prosemirror-keymap';
import { baseKeymap, toggleMark, setBlockType, lift } from 'prosemirror-commands';
import {
  wrapInList,
  splitListItem,
  liftListItem,
  sinkListItem,
} from 'prosemirror-schema-list';
import { history, undo, redo } from 'prosemirror-history';
import { wrapIn } from 'prosemirror-commands';

// ── Schema ──────────────────────────────────────────────────────────────────

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },

    paragraph: {
      content: 'inline*',
      group: 'block',
      parseDOM: [{ tag: 'p' }],
      toDOM() {
        return ['p', 0];
      },
    },

    heading: {
      attrs: { level: { default: 1 } },
      content: 'inline*',
      group: 'block',
      defining: true,
      parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
        tag: `h${level}`,
        attrs: { level },
      })),
      toDOM(node) {
        return [`h${node.attrs.level}`, 0];
      },
    },

    blockquote: {
      content: 'block+',
      group: 'block',
      defining: true,
      parseDOM: [{ tag: 'blockquote' }],
      toDOM() {
        return ['blockquote', 0];
      },
    },

    code_block: {
      attrs: { info: { default: '' } },
      content: 'text*',
      marks: '',
      group: 'block',
      code: true,
      defining: true,
      parseDOM: [
        {
          tag: 'pre',
          preserveWhitespace: 'full' as const,
          getAttrs(dom: HTMLElement) {
            return { info: dom.getAttribute('data-fence-info') || '' };
          },
        },
      ],
      toDOM(node) {
        return node.attrs.info
          ? ['pre', { 'data-fence-info': node.attrs.info }, ['code', 0]]
          : ['pre', ['code', 0]];
      },
    },

    bullet_list: {
      content: 'list_item+',
      group: 'block',
      parseDOM: [{ tag: 'ul' }],
      toDOM() {
        return ['ul', 0];
      },
    },

    ordered_list: {
      content: 'list_item+',
      group: 'block',
      attrs: { order: { default: 1 } },
      parseDOM: [
        {
          tag: 'ol',
          getAttrs(dom: HTMLElement) {
            return { order: dom.getAttribute('start') || 1 };
          },
        },
      ],
      toDOM(node) {
        return node.attrs.order === 1
          ? ['ol', 0]
          : ['ol', { start: node.attrs.order }, 0];
      },
    },

    list_item: {
      content: 'paragraph block*',
      defining: true,
      parseDOM: [{ tag: 'li' }],
      toDOM() {
        return ['li', 0];
      },
    },

    horizontal_rule: {
      group: 'block',
      parseDOM: [{ tag: 'hr' }],
      toDOM() {
        return ['hr'];
      },
    },

    hard_break: {
      inline: true,
      group: 'inline',
      selectable: false,
      parseDOM: [{ tag: 'br' }],
      toDOM() {
        return ['br'];
      },
    },

    text: { group: 'inline' },

    // ── Custom card placeholder nodes ──

    boxel_card_atom: {
      attrs: {
        cardId: {},
        label: { default: '' },
      },
      inline: true,
      group: 'inline',
      atom: true,
      draggable: true,
      parseDOM: [
        {
          tag: 'span[data-boxel-card-atom]',
          getAttrs(dom: HTMLElement) {
            return {
              cardId: dom.getAttribute('data-card-id'),
              label: dom.getAttribute('data-label') || dom.textContent,
            };
          },
        },
      ],
      toDOM(node) {
        return [
          'span',
          {
            'data-boxel-card-atom': '',
            'data-card-id': node.attrs.cardId,
            'data-label': node.attrs.label,
            class: 'boxel-card-atom',
          },
          ['span', { class: 'atom-label' }, node.attrs.label || node.attrs.cardId],
        ];
      },
    },

    boxel_card_block: {
      attrs: {
        cardId: {},
        format: { default: 'embedded' },
        size: { default: 'full' },
      },
      group: 'block',
      atom: true,
      draggable: true,
      parseDOM: [
        {
          tag: 'div[data-boxel-card-block]',
          getAttrs(dom: HTMLElement) {
            return {
              cardId: dom.getAttribute('data-card-id'),
              format: dom.getAttribute('data-format') || 'embedded',
              size: dom.getAttribute('data-size') || 'full',
            };
          },
        },
      ],
      toDOM(node) {
        return [
          'div',
          {
            'data-boxel-card-block': '',
            'data-card-id': node.attrs.cardId,
            'data-format': node.attrs.format,
            'data-size': node.attrs.size,
            class: `boxel-card-block format-${node.attrs.format}`,
          },
          ['div', { class: 'card-block-id' }, node.attrs.cardId],
        ];
      },
    },
  },

  marks: {
    strong: {
      parseDOM: [
        { tag: 'strong' },
        {
          tag: 'b',
          getAttrs(node: HTMLElement) {
            return node.style.fontWeight !== 'normal' && null;
          },
        },
        {
          style: 'font-weight=400',
          clearMark(m: any) {
            return m.type.name === 'strong';
          },
        },
        {
          style: 'font-weight',
          getAttrs(value: string) {
            return /^(bold(er)?|[5-9]\d{2,})$/.test(value) && null;
          },
        },
      ],
      toDOM() {
        return ['strong', 0];
      },
    },

    em: {
      parseDOM: [{ tag: 'i' }, { tag: 'em' }, { style: 'font-style=italic' }],
      toDOM() {
        return ['em', 0];
      },
    },

    code: {
      parseDOM: [{ tag: 'code' }],
      toDOM() {
        return ['code', 0];
      },
    },

    link: {
      attrs: { href: {}, title: { default: null } },
      inclusive: false,
      parseDOM: [
        {
          tag: 'a[href]',
          getAttrs(dom: HTMLElement) {
            return {
              href: dom.getAttribute('href'),
              title: dom.getAttribute('title'),
            };
          },
        },
      ],
      toDOM(node) {
        return [
          'a',
          { href: node.attrs.href, title: node.attrs.title },
          0,
        ];
      },
    },
  },
});

// ── Markdown → ProseMirror ─────────────────────────────────────────────────

function parseInlineContent(text: string): ProseMirrorNode[] {
  let nodes: ProseMirrorNode[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    // Link: [text](url) or [text](url "title")
    let linkMatch = remaining.match(
      /^\[([^\]]+)\]\((\S+?)(?:\s+"([^"]*)")?\)/,
    );
    if (linkMatch) {
      let href = linkMatch[2];
      let title = linkMatch[3] || null;
      nodes.push(
        schema.text(linkMatch[1], [
          schema.marks.link.create({ href, title }),
        ]),
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Bold+italic: ***text***
    let boldItalicMatch = remaining.match(/^\*\*\*([^*]+)\*\*\*/);
    if (boldItalicMatch) {
      nodes.push(
        schema.text(boldItalicMatch[1], [
          schema.marks.strong.create(),
          schema.marks.em.create(),
        ]),
      );
      remaining = remaining.slice(boldItalicMatch[0].length);
      continue;
    }

    // Bold: **text**
    let boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      nodes.push(
        schema.text(boldMatch[1], [schema.marks.strong.create()]),
      );
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic: *text*
    let italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      nodes.push(
        schema.text(italicMatch[1], [schema.marks.em.create()]),
      );
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Inline code: `text`
    let codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      nodes.push(
        schema.text(codeMatch[1], [schema.marks.code.create()]),
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Block card reference in inline context (::card[URL]) — treat as plain text
    let blockCardInlineMatch = remaining.match(/^::card\[([^\]]+)\]/);
    if (blockCardInlineMatch) {
      nodes.push(schema.text(blockCardInlineMatch[0]));
      remaining = remaining.slice(blockCardInlineMatch[0].length);
      continue;
    }

    // Card atom: :card[URL]
    let cardAtomMatch = remaining.match(/^:card\[([^\]]+)\]/);
    if (cardAtomMatch) {
      let cardId = cardAtomMatch[1].trim();
      let label = cardId.split('/').filter(Boolean).pop() || cardId;
      nodes.push(schema.nodes.boxel_card_atom.create({ cardId, label }));
      remaining = remaining.slice(cardAtomMatch[0].length);
      continue;
    }

    // Plain text until next special character
    let plainMatch = remaining.match(/^[^*`\[:\n]+/);
    if (plainMatch) {
      nodes.push(schema.text(plainMatch[0]));
      remaining = remaining.slice(plainMatch[0].length);
      continue;
    }

    // Single special char that didn't match a pattern
    nodes.push(schema.text(remaining[0]));
    remaining = remaining.slice(1);
  }

  return nodes;
}

function parseMarkdown(text: string): ProseMirrorNode {
  if (!text || text.trim() === '') {
    return schema.node('doc', null, [schema.node('paragraph')]);
  }

  let blocks: ProseMirrorNode[] = [];
  let lines = text.split('\n');
  let i = 0;

  while (i < lines.length) {
    let line = lines[i];

    // Empty line — skip
    if (line.trim() === '') {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^(---|\*\*\*|___)$/.test(line.trim())) {
      blocks.push(schema.node('horizontal_rule'));
      i++;
      continue;
    }

    // Code block
    if (line.trim().startsWith('```')) {
      let info = line.trim().slice(3).trim();
      let codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      let codeText = codeLines.join('\n');
      blocks.push(
        schema.node(
          'code_block',
          { info },
          codeText ? [schema.text(codeText)] : [],
        ),
      );
      continue;
    }

    // Heading
    let headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      let level = headingMatch[1].length;
      let content = parseInlineContent(headingMatch[2]);
      blocks.push(
        schema.node('heading', { level }, content.length ? content : undefined),
      );
      i++;
      continue;
    }

    // Block card: ::card[URL] or ::card[URL | specifier]
    let blockCardMatch = line.trim().match(/^::card\[([^\]]+)\]/);
    if (blockCardMatch) {
      let raw = blockCardMatch[1];
      let pipeIdx = raw.indexOf('|');
      let cardId = pipeIdx >= 0 ? raw.substring(0, pipeIdx).trim() : raw.trim();
      blocks.push(schema.nodes.boxel_card_block.create({ cardId }));
      i++;
      continue;
    }

    // Blockquote
    if (line.startsWith('> ') || line === '>') {
      let quoteLines: string[] = [];
      while (
        i < lines.length &&
        (lines[i].startsWith('> ') || lines[i] === '>')
      ) {
        quoteLines.push(lines[i] === '>' ? '' : lines[i].slice(2));
        i++;
      }
      // Split into paragraphs on empty lines within the blockquote
      let paragraphs: ProseMirrorNode[] = [];
      let currentLines: string[] = [];
      for (let ql of quoteLines) {
        if (ql === '') {
          if (currentLines.length > 0) {
            let paraContent = parseInlineContent(currentLines.join(' '));
            paragraphs.push(
              schema.node(
                'paragraph',
                null,
                paraContent.length ? paraContent : undefined,
              ),
            );
            currentLines = [];
          }
        } else {
          currentLines.push(ql);
        }
      }
      if (currentLines.length > 0) {
        let paraContent = parseInlineContent(currentLines.join(' '));
        paragraphs.push(
          schema.node(
            'paragraph',
            null,
            paraContent.length ? paraContent : undefined,
          ),
        );
      }
      blocks.push(
        schema.node(
          'blockquote',
          null,
          paragraphs.length > 0 ? paragraphs : [schema.node('paragraph')],
        ),
      );
      continue;
    }

    // Bullet list
    if (/^[-*+]\s/.test(line)) {
      let items: ProseMirrorNode[] = [];
      while (i < lines.length && /^[-*+]\s/.test(lines[i])) {
        let itemText = lines[i].replace(/^[-*+]\s/, '');
        let itemContent = parseInlineContent(itemText);
        items.push(
          schema.node('list_item', null, [
            schema.node(
              'paragraph',
              null,
              itemContent.length ? itemContent : undefined,
            ),
          ]),
        );
        i++;
      }
      blocks.push(schema.node('bullet_list', null, items));
      continue;
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      let items: ProseMirrorNode[] = [];
      let startOrder = parseInt(line.match(/^(\d+)/)![1], 10);
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        let itemText = lines[i].replace(/^\d+\.\s/, '');
        let itemContent = parseInlineContent(itemText);
        items.push(
          schema.node('list_item', null, [
            schema.node(
              'paragraph',
              null,
              itemContent.length ? itemContent : undefined,
            ),
          ]),
        );
        i++;
      }
      blocks.push(schema.node('ordered_list', { order: startOrder }, items));
      continue;
    }

    // Regular paragraph
    let content = parseInlineContent(line);
    blocks.push(
      schema.node('paragraph', null, content.length ? content : undefined),
    );
    i++;
  }

  return schema.node(
    'doc',
    null,
    blocks.length > 0 ? blocks : [schema.node('paragraph')],
  );
}

// ── ProseMirror → Markdown ─────────────────────────────────────────────────

function serializeInlineContent(node: ProseMirrorNode): string {
  let result = '';
  node.forEach((child) => {
    if (child.isText) {
      let text = child.text || '';
      let marks = child.marks;
      let hasStrong = marks.some((m) => m.type.name === 'strong');
      let hasEm = marks.some((m) => m.type.name === 'em');
      let hasCode = marks.some((m) => m.type.name === 'code');
      let link = marks.find((m) => m.type.name === 'link');

      if (hasCode) {
        text = `\`${text}\``;
      } else {
        if (hasStrong && hasEm) {
          text = `***${text}***`;
        } else if (hasStrong) {
          text = `**${text}**`;
        } else if (hasEm) {
          text = `*${text}*`;
        }
      }
      if (link) {
        text = link.attrs.title
          ? `[${text}](${link.attrs.href} "${link.attrs.title}")`
          : `[${text}](${link.attrs.href})`;
      }
      result += text;
    } else if (child.type.name === 'hard_break') {
      result += '  \n';
    } else if (child.type.name === 'boxel_card_atom') {
      result += `:card[${child.attrs.cardId}]`;
    }
  });
  return result;
}

function serializeNode(node: ProseMirrorNode): string {
  switch (node.type.name) {
    case 'paragraph':
      return serializeInlineContent(node);
    case 'heading':
      return '#'.repeat(node.attrs.level) + ' ' + serializeInlineContent(node);
    case 'horizontal_rule':
      return '---';
    case 'blockquote': {
      let parts: string[] = [];
      node.forEach((child, _offset, idx) => {
        if (idx > 0) {
          parts.push('>');
        }
        let serialized = serializeNode(child);
        for (let line of serialized.split('\n')) {
          parts.push('> ' + line);
        }
      });
      return parts.join('\n');
    }
    case 'code_block': {
      let info = node.attrs.info || '';
      let content = node.textContent;
      return content
        ? `\`\`\`${info}\n${content}\n\`\`\``
        : `\`\`\`${info}\n\`\`\``;
    }
    case 'bullet_list': {
      let items: string[] = [];
      node.forEach((item) => {
        item.forEach((child, _offset, idx) => {
          if (idx === 0) {
            items.push('- ' + serializeNode(child));
          } else {
            items.push('  ' + serializeNode(child));
          }
        });
      });
      return items.join('\n');
    }
    case 'ordered_list': {
      let items: string[] = [];
      let num = node.attrs.order || 1;
      node.forEach((item) => {
        item.forEach((child, _offset, idx) => {
          if (idx === 0) {
            items.push(`${num}. ` + serializeNode(child));
          } else {
            items.push('   ' + serializeNode(child));
          }
        });
        num++;
      });
      return items.join('\n');
    }
    case 'boxel_card_block': {
      let { cardId } = node.attrs;
      return `::card[${cardId}]`;
    }
    default:
      return node.textContent || '';
  }
}

function serializeMarkdown(doc: ProseMirrorNode): string {
  let blocks: string[] = [];
  doc.forEach((node) => {
    blocks.push(serializeNode(node));
  });
  return blocks.join('\n\n');
}

// ── Exported context ───────────────────────────────────────────────────────

export interface ProseMirrorContext {
  schema: typeof schema;
  EditorState: typeof EditorState;
  EditorView: typeof EditorView;
  keymap: typeof keymap;
  baseKeymap: typeof baseKeymap;
  history: typeof history;
  undo: typeof undo;
  redo: typeof redo;
  toggleMark: typeof toggleMark;
  setBlockType: typeof setBlockType;
  wrapIn: typeof wrapIn;
  lift: typeof lift;
  wrapInList: typeof wrapInList;
  splitListItem: typeof splitListItem;
  liftListItem: typeof liftListItem;
  sinkListItem: typeof sinkListItem;
  parseMarkdown: (text: string) => ProseMirrorNode;
  serializeMarkdown: (doc: ProseMirrorNode) => string;
}

const prosemirrorContext: ProseMirrorContext = {
  schema,
  EditorState,
  EditorView,
  keymap,
  baseKeymap,
  history,
  undo,
  redo,
  toggleMark,
  setBlockType,
  wrapIn,
  lift,
  wrapInList,
  splitListItem,
  liftListItem,
  sinkListItem,
  parseMarkdown,
  serializeMarkdown,
};

export default prosemirrorContext;
