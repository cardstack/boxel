import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import GlimmerComponent from '@glimmer/component';
import { Button } from '@cardstack/boxel-ui/components';
import { cn, gt } from '@cardstack/boxel-ui/helpers';
import {
  Component,
  field,
  contains,
  containsMany,
  StringField,
  type BaseDefComponent,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { Skill, CommandField } from 'https://cardstack.com/base/skill';
import FileIcon from '@cardstack/boxel-icons/file';

// Shared slugify function - SINGLE SOURCE OF TRUTH for ID generation
export function slugifyHeading(text: string): string {
  return (
    text
      .toLowerCase()
      .trim()
      // Remove leading numbers and dots (e.g., "1. ", "2.1 ", "1.2.3 ")
      .replace(/^[\d.]+\s+/, '')
      .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Remove emoji
      .replace(/[\u{2600}-\u{26FF}]/gu, '')
      .replace(/[\u{2700}-\u{27BF}]/gu, '')
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
  );
}

type TocItem = { level: number; text: string; id: string };

// Parse headers from markdown text with deterministic ID generation
export function parseMarkdownHeaders(markdown?: string): Array<TocItem> {
  if (!markdown) {
    return [];
  }
  const headers: Array<TocItem> = [];
  const usedIds = new Set<string>();

  const headerRegex = /^(#{2,3})\s+(.+)$/gm;
  let match;

  while ((match = headerRegex.exec(markdown)) !== null) {
    const level = match[1].length;
    let text = match[2].trim();

    // Check for explicit ID: {#custom-id}
    const idMatch = text.match(/\{#([a-z0-9-]+)\}/);
    const explicitId = idMatch ? idMatch[1] : null;

    // Remove {#id} from display text
    text = text.replace(/\s*\{#[a-z0-9-]+\}\s*/, '').trim();

    // Generate base ID
    let baseId = explicitId || slugifyHeading(text);

    // Deduplicate IDs
    let finalId = baseId;
    let suffix = 2;
    while (usedIds.has(finalId)) {
      finalId = `${baseId}-${suffix}`;
      suffix++;
    }
    usedIds.add(finalId);

    headers.push({ level, text, id: finalId });
  }

  return headers;
}

// Modifier to add IDs to rendered markdown headers for TOC markdown anchor links
export const addHeaderIds = modifier((element: HTMLElement) => {
  const headers = element.querySelectorAll('h2, h3, h4, h5, h6');
  const usedIds = new Set<string>();

  headers.forEach((header) => {
    if (header.getAttribute('id')) return; // Skip if already has ID

    const text = header.textContent || '';

    // Check for explicit ID in text
    const idMatch = text.match(/\{#([a-z0-9-]+)\}/);
    let baseId: string;

    if (idMatch) {
      baseId = idMatch[1];
      // Remove {#id} from display
      header.textContent = text.replace(/\s*\{#[a-z0-9-]+\}\s*/, '').trim();
    } else {
      baseId = slugifyHeading(text);
    }

    // Deduplicate IDs
    let finalId = baseId;
    let suffix = 2;
    while (usedIds.has(finalId)) {
      finalId = `${baseId}-${suffix}`;
      suffix++;
    }

    if (finalId) {
      header.setAttribute('id', finalId);
      usedIds.add(finalId);
    }
  });
});

export class TocSection extends GlimmerComponent<{
  Args: {
    sectionTitle: string;
    navItems?: TocItem[];
  };
  Element: HTMLElement;
  Blocks: { default: [] };
}> {
  <template>
    <div class='toc-section' ...attributes>
      <div class='toc-section-title'>{{@sectionTitle}}</div>
      {{#if @navItems.length}}
        <ul>
          {{#each @navItems as |item|}}
            <li
              class={{if (gt item.level 2) 'toc-subsection' 'toc-section-item'}}
            >
              <a
                href='#{{item.id}}'
                {{on 'click' (fn this.scrollToItem item.id)}}
              >{{item.text}}</a>
            </li>
          {{/each}}
        </ul>
      {{else}}
        {{yield}}
      {{/if}}
    </div>
    <style scoped>
      :deep(ul) {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      :deep(li) {
        margin-bottom: var(--sp-2);
        color: var(--db-foreground);
      }
      :deep(ul ul) {
        margin-top: var(--sp-1);
        padding-left: var(--sp-3);
      }
      :deep(ul ul li) {
        padding-left: var(--sp-3);
      }
      :deep(a) {
        text-decoration: none;
      }
      :deep(a:hover) {
        color: inherit;
        text-decoration: underline;
      }
      .toc-section-title {
        font-size: var(--boxel-font-size-2xs);
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-xxl);
        margin-bottom: var(--boxel-sp-sm);
        padding-bottom: var(--boxel-sp-xs);
        border-bottom: 1px solid var(--db-border);
      }
      .toc-section {
        margin-bottom: var(--boxel-sp-lg);
      }
      .toc-subsection {
        padding-left: var(--boxel-sp);
        font-size: var(--boxel-font-size-xs);
      }
    </style>
  </template>

  private scrollToItem = (id: string, event: Event) => {
    event.preventDefault();
    document
      .querySelector(`#${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

export class EmptyStateContainer extends GlimmerComponent<{
  Blocks: { default: [] };
}> {
  <template>
    <div class='empty-state'>
      <FileIcon class='empty-icon' width='64' height='64' role='presentation' />
      {{yield}}
    </div>
    <style scoped>
      .empty-state {
        text-align: center;
        padding: var(--boxel-sp-2xl);
        max-width: 42rem;
        margin: 0 auto;
        color: var(--db-muted-foreground);
      }
      .empty-icon {
        width: 4rem;
        height: 4rem;
      }
      :deep(h3) {
        margin-block: var(--boxel-sp-sm);
        font-size: var(--boxel-font-size-lg);
        color: var(--db-foreground);
      }
      :deep(p) {
        margin-bottom: var(--boxel-sp-sm);
        font-size: var(--boxel-font-size);
      }
      :deep(ul) {
        display: inline-block;
        list-style: none;
        padding: 0;
        margin-block: var(--boxel-sp);
        margin-inline: 0;
      }
      :deep(li) {
        display: flex;
        gap: var(--boxel-sp-sm);
        font-size: var(--boxel-font-size-sm);
        line-height: 1.6;
      }
      :deep(li svg) {
        width: 1.5rem;
        height: 1.5rem;
        flex-shrink: 0;
      }
      :deep(li + li) {
        margin-top: var(--boxel-sp-lg);
      }
      :deep(strong) {
        color: var(--db-foreground);
        font-weight: 600;
      }
    </style>
  </template>
}

export class AppendixSection extends GlimmerComponent<{
  Blocks: { default: [] };
}> {
  <template>
    <section class='appendix' id='appendix-section'>
      <header class='appendix-header'>
        <h2>Appendix</h2>
      </header>
      {{yield}}
    </section>
    <style scoped>
      .appendix > :deep(* + *) {
        margin-top: var(--boxel-sp-2xl);
      }
      .appendix-header {
        margin-top: var(--boxel-sp-4xl);
        margin-bottom: var(--boxel-sp-xl);
        padding-block: var(--boxel-sp-xl);
        border-top: 1px solid var(--db-border);
        border-bottom: 1px solid var(--db-border);
      }
      :deep(h2) {
        font-size: var(--boxel-font-size-lg);
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: var(--boxel-lsp-xl);
        color: var(--db-muted-foreground);
        text-align: center;
      }
      :deep(h3) {
        font-size: var(--boxel-font-size-md);
        margin-bottom: var(--boxel-sp-lg);
      }
      .commands-section {
        padding: var(--boxel-sp-lg);
        background: var(--db-muted);
        border: 1px solid var(--db-border);
        border-radius: var(--boxel-border-radius-lg);
      }
      .commands-container {
        gap: var(--boxel-sp);
      }
    </style>
  </template>
}

export class DocLayout extends GlimmerComponent<{
  Args: {
    description?: string;
    title?: string;
    titleMeta?: string;
    hideToc?: boolean;
  };
  Element: HTMLElement;
  Blocks: { default: []; navbar: []; headerRow: [] };
}> {
  <template>
    <div
      class={{cn 'doc-layout' doc-layout--single-col=@hideToc}}
      ...attributes
    >
      {{#unless @hideToc}}
        <aside class='toc-sidebar'>
          <div class='toc-header'>
            <h2 class='toc-title'>Table of Contents</h2>
            <Button
              @as='anchor'
              href='#top'
              @kind='muted'
              @size='extra-small'
              @rectangular={{true}}
              class='top-button'
              {{on 'click' this.scrollToTop}}
            >
              ↑ TOP
            </Button>
          </div>
          <nav class='toc-navigation'>
            {{yield to='navbar'}}
          </nav>
        </aside>
      {{/unless}}

      <main class='doc-main'>
        <header id='top' class='doc-header'>
          <div class='metadata-label'>
            {{if @titleMeta @titleMeta 'Documentation'}}
          </div>
          <h1 class='doc-heading'>{{@title}}</h1>
          {{#if @description}}
            <p class='doc-subtitle'>{{@description}}</p>
          {{/if}}
          {{yield to='headerRow'}}
        </header>

        {{yield}}
      </main>
    </div>

    <style scoped>
      @layer {
        .doc-layout {
          --sp-1: var(--spacing, 0.25rem);
          --sp-2: calc(var(--sp-1) * 2);
          --sp-3: calc(var(--sp-1) * 3);
          --sp-4: calc(var(--sp-1) * 4);
          --sp-5: calc(var(--sp-1) * 5);
          --sp-6: calc(var(--sp-1) * 6);
          --db-background: var(--background, var(--boxel-light));
          --db-foreground: var(--foreground, var(--boxel-700));
          --db-primary: var(--primary, var(--boxel-highlight-hover));
          --db-muted-foreground: var(
            --muted-foreground,
            color-mix(in oklab, var(--db-foreground) 60%, var(--db-background))
          );
          --db-muted: var(
            --muted,
            color-mix(in oklab, var(--db-foreground) 10%, var(--db-background))
          );
          --db-border: var(
            --border,
            color-mix(in oklab, var(--db-foreground) 20%, var(--db-background))
          );

          width: 100%;
          height: 100%;
          max-width: 100rem;
          display: grid;
          grid-template-columns: 15rem 1fr;
          gap: var(--boxel-sp);
          margin: 0 auto;
          padding: var(--boxel-sp);
          padding-right: 0;
          background-color: var(--db-background);
          color: var(--db-foreground);
          overflow: hidden;
        }
        .doc-layout--single-col {
          grid-template-columns: 1fr;
        }

        .toc-sidebar {
          display: flex;
          flex-direction: column;
          background-color: var(--db-muted);
          color: var(--db-muted-foreground);
          font-size: var(--boxel-font-size-xs);
          border: 1px solid var(--db-border);
          border-radius: var(--boxel-border-radius-lg);
          padding: var(--boxel-sp);
          padding-bottom: var(--boxel-sp-lg);
          overflow-y: auto;
        }
        .toc-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: var(--boxel-sp-3xs);
          margin-bottom: var(--boxel-sp-xs);
        }
        .toc-title {
          font-size: var(--boxel-font-size-xs);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-xl);
        }
        .top-button {
          --boxel-button-min-width: max-content;
          font-size: var(--boxel-font-size-2xs);
        }

        .doc-main {
          overflow: auto;
          padding-right: var(--boxel-sp);
          padding-bottom: var(--boxel-sp-2xl);
        }
        .doc-header {
          border-bottom: 2px solid var(--db-border);
        }
        .metadata-label {
          margin-bottom: var(--boxel-sp-xs);
          font-size: var(--boxel-font-size-2xs);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-xxl);
          color: var(--db-muted-foreground);
        }
        .doc-heading {
          margin-bottom: var(--boxel-sp-xs);
          font-size: 1.5rem;
          line-height: 1.2;
          letter-spacing: -0.01em;
        }
        .doc-subtitle {
          margin-bottom: var(--boxel-sp);
          line-height: 1.5;
          color: var(--db-muted-foreground);
          max-width: 48rem;
        }

        /* Markdown content */
        .doc-main :deep(.markdown-content) {
          font-size: 0.9375rem;
          line-height: 1.7;
        }
        .doc-main :deep(.markdown-content h2) {
          font-size: 1.375rem;
          font-weight: 700;
          line-height: 1.3;
          margin-top: var(--sp-6);
          margin-bottom: var(--sp-3);
          scroll-margin-top: 6rem; /* Increased for sticky TOC offset */
          padding-top: var(--sp-2);
        }
        .doc-main :deep(.markdown-content h2:first-child) {
          margin-top: 0;
        }
        .doc-main :deep(.markdown-content h3) {
          font-size: 1.125rem;
          font-weight: 500;
          line-height: 1.4;
          margin-top: var(--sp-6);
          margin-bottom: var(--sp-2);
          color: var(--foreground);
          scroll-margin-top: 6rem; /* Increased for sticky TOC offset */
        }
        .doc-main :deep(.markdown-content h4) {
          font-size: 1rem;
          font-weight: 600;
          line-height: 1.5;
          margin-top: var(--sp-4);
          margin-bottom: var(--sp-2);
        }
        .doc-main :deep(.markdown-content p) {
          margin: var(--sp-3) 0;
          line-height: 1.6;
        }
        .doc-main :deep(.markdown-content ul),
        .doc-main :deep(.markdown-content ol) {
          margin: var(--sp-3) 0;
          padding-left: var(--sp-6);
        }
        .doc-main :deep(.markdown-content li) {
          margin: var(--sp-2) 0;
          line-height: 1.5;
        }
        .instructions-article :deep(pre),
        .instructions-article :deep(code) {
          --code-bg: color-mix(in lab, var(--db-primary) 8%, var(--db-muted));
          background-color: var(--code-bg, var(--db-muted));
        }
        .doc-main :deep(.markdown-content code) {
          font-size: 0.875em;
          padding: 0.125rem 0.25rem;
          border-radius: var(--boxel-border-radius-sm);
        }
        .doc-main :deep(.markdown-content pre) {
          margin: var(--sp-4) 0;
          padding: var(--sp-3);
          border: 1px solid var(--db-border);
          border-left: 3px solid var(--db-primary);
          overflow-x: auto;
          font-size: 0.8125rem;
          line-height: 1.5;
        }
        .doc-main :deep(.markdown-content pre code) {
          background: transparent;
          padding: 0;
        }
        .doc-main :deep(.markdown-content blockquote) {
          margin: var(--sp-4) 0;
          padding: var(--sp-3) var(--sp-4);
          border-left: 3px solid var(--primary);
          background: var(--muted);
          border-radius: 0 var(--boxel-border-radius-sm)
            var(--boxel-border-radius-sm) 0;
          font-style: italic;
        }
        .doc-main :deep(.markdown-content a) {
          color: var(--primary);
          text-decoration: none;
          transition: color 0.15s ease;
        }
        .doc-main :deep(.markdown-content a:hover) {
          text-decoration: underline;
        }
        .doc-main :deep(.markdown-content strong) {
          font-weight: 600;
          color: var(--db-foreground);
        }
        .doc-main :deep(.markdown-content table) {
          font-size: 0.875rem;
        }
        .doc-main :deep(.markdown-content th) {
          padding: 0.75rem 1rem;
        }
        .doc-main :deep(.markdown-content td) {
          padding: 0.625rem 1rem;
          vertical-align: top;
        }
        .doc-main :deep(.markdown-content tbody tr:hover) {
          background: color-mix(in lab, var(--primary) 5%, var(--card));
        }
        /* Code in tables */
        .doc-main :deep(.markdown-content table code) {
          font-size: 0.75rem;
          white-space: nowrap;
        }
        .doc-main :deep(.markdown-content .highlighted-section) {
          padding: 2rem;
          margin: 2.5rem 0;
          background: var(--accent);
          border: 1px solid var(--db-border);
          border-radius: 12px;
        }

        @media (max-width: 640px) {
          .doc-layout {
            grid-template-columns: 1fr;
            padding: var(--boxel-sp-xs);
            overflow-y: auto;
          }
          .toc-sidebar {
            display: none;
          }
          .toc-sidebar,
          .doc-main {
            overflow-y: initial;
          }
        }
      }
    </style>
  </template>

  private scrollToTop = (event: Event) => {
    event.preventDefault();
    document
      .querySelector('#top')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

export class SkillPlus extends Skill {
  static displayName = 'Skill Plus';
  static prefersWideFormat = true;

  // override skill card's title field to be computed of cardInfo.title
  @field title = contains(StringField, {
    computeVia: function (this: SkillPlus) {
      return this.cardInfo?.title ?? `Untitled ${SkillPlus.displayName}`;
    },
  });

  // override skill card's description field to be computed of cardInfo.description
  @field description = contains(StringField, {
    computeVia: function (this: SkillPlus) {
      return this.cardInfo?.description;
    },
  });

  @field instructions = contains(MarkdownField);
  @field commands = containsMany(CommandField);

  static isolated: BaseDefComponent = class Isolated extends Component<
    typeof this
  > {
    private get isTocEmpty() {
      return (
        !this.args.model?.instructions && !this.args.model?.commands?.length
      );
    }

    <template>
      <DocLayout
        @titleMeta='Skill Plus Documentation'
        @title={{@model.title}}
        @description={{@model.description}}
        @hideToc={{this.isTocEmpty}}
      >
        <:navbar>
          {{#if @model.instructions}}
            <TocSection
              @sectionTitle='Content'
              @navItems={{parseMarkdownHeaders @model.instructions}}
            />
          {{/if}}
          {{#if @model.commands.length}}
            <TocSection @sectionTitle='Appendix'>
              <ul>
                <li><a href='#available-commands'>Available Commands</a></li>
              </ul>
            </TocSection>
          {{/if}}
        </:navbar>
        <:default>
          {{#if @model.instructions}}
            <article
              class='instructions-article'
              id='instructions'
              {{addHeaderIds}}
            >
              <@fields.instructions />
            </article>
          {{else}}
            <EmptyStateContainer>
              <h3>Welcome to SkillPlus</h3>
              <p>
                This skill is currently empty. Get started by adding
                instructions.
              </p>
            </EmptyStateContainer>
          {{/if}}

          {{! Commands section }}
          {{#if @model.commands.length}}
            <AppendixSection>
              <section class='commands-section' id='available-commands'>
                <h3 class='section-heading'>Available Commands</h3>
                <@fields.commands
                  @format='embedded'
                  class='commands-container'
                />
              </section>
            </AppendixSection>
          {{/if}}
        </:default>
      </DocLayout>
    </template>
  };
}
