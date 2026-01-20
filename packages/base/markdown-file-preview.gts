import { Component } from './card-api';
import type { MarkdownDef } from './markdown-file-def';

export default class MarkdownFilePreview extends Component<typeof MarkdownDef> {
  get title() {
    return (
      this.args.model?.title ?? this.args.model?.name ?? 'Untitled markdown'
    );
  }

  get excerpt() {
    return this.args.model?.excerpt ?? '';
  }

  get hasExcerpt() {
    return Boolean(this.excerpt);
  }

  <template>
    <article class='markdown-file-preview' data-test-markdown-file-preview>
      <header class='markdown-file-preview__title'>{{this.title}}</header>
      {{#if this.hasExcerpt}}
        <p class='markdown-file-preview__excerpt'>{{this.excerpt}}</p>
      {{else}}
        <p class='markdown-file-preview__empty'>No preview available.</p>
      {{/if}}
    </article>
    <style scoped>
      .markdown-file-preview {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-2xs);
      }

      .markdown-file-preview__title {
        color: var(--boxel-900);
        font-weight: 600;
      }

      .markdown-file-preview__excerpt,
      .markdown-file-preview__empty {
        color: var(--boxel-600);
        font-size: var(--boxel-font-sm);
        margin: 0;
      }
    </style>
  </template>
}
