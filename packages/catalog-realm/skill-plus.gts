import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import GlimmerComponent from '@glimmer/component';
import { Button } from '@cardstack/boxel-ui/components';
import { cn, gt } from '@cardstack/boxel-ui/helpers';
import {
  Component,
  FieldDef,
  field,
  contains,
  linksToMany,
  containsMany,
  StringField,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { Skill, CommandField } from 'https://cardstack.com/base/skill';
import FileIcon from '@cardstack/boxel-icons/file';

// Shared slugify function - SINGLE SOURCE OF TRUTH for ID generation
function slugifyHeading(text: string): string {
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

// Parse headers from markdown text with deterministic ID generation
function parseMarkdownHeaders(
  markdown: string,
): Array<{ level: number; text: string; id: string }> {
  const headers: Array<{ level: number; text: string; id: string }> = [];
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

// Modifier to add IDs to rendered markdown headers
const addHeaderIds = modifier((element: HTMLElement) => {
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

class TocSection extends GlimmerComponent<{
  sectionTitle: string;
  navItems?: { level: number; id: string; text: string }[];
}> {
  <template>
    <div class='toc-section'>
      <div class='toc-section-title'>{{@sectionTitle}}</div>
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
    </div>
    <style scoped>
      ul {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      li {
        margin-bottom: var(--boxel-sp-xs);
        color: var(--foreground);
      }
      a:hover {
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
        border-bottom: 1px solid var(--border, var(--boxel-border-color));
      }
      .toc-section {
        margin-bottom: var(--boxel-sp-lg);
      }
      .toc-subsection {
        padding-left: var(--boxel-sp);
        font-size: var(--boxel-font-size-2xs);
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

class DocLayout extends GlimmerComponent<{
  Args: {
    description?: string;
    title?: string;
    titleMeta?: string;
    hideToc?: boolean;
  };
  Blocks: { default: []; navbar: [] };
}> {
  <template>
    <div class={{cn 'doc-layout' doc-layout--single-col=@hideToc}}>
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
          {{#if @titleMeta}}
            <div class='metadata-label'>{{@titleMeta}}</div>
          {{/if}}
          <h1 class='doc-heading'>{{@title}}</h1>
          {{#if @description}}
            <p class='doc-subtitle'>{{@description}}</p>
          {{/if}}
        </header>

        {{yield}}
      </main>
    </div>

    <style scoped>
      @layer {
        .doc-layout {
          width: 100%;
          height: 100%;
          max-width: 100rem;
          display: grid;
          grid-template-columns: 15rem 1fr;
          gap: var(--boxel-sp);
          margin: 0 auto;
          padding: var(--boxel-sp);
          padding-right: 0;
          overflow: hidden;
        }
        .doc-layout--single-col {
          grid-template-columns: 1fr;
        }

        .toc-sidebar {
          display: flex;
          flex-direction: column;
          background-color: var(--muted, var(--boxel-100));
          color: var(--muted-foreground, var(--boxel-700));
          font-size: var(--boxel-font-size-xs);
          border: 1px solid var(--border, var(--boxel-border-color));
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
          overflow-y: auto;
          padding-right: var(--boxel-sp);
          padding-bottom: var(--boxel-sp-2xl);
        }
        .doc-header {
          padding-bottom: var(--boxel-sp-lg);
          border-bottom: 2px solid var(--border, var(--boxel-border-color));
        }
        .metadata-label {
          font-size: var(--boxel-font-size-2xs);
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: var(--boxel-lsp-xxl);
          color: var(--muted-foreground);
          margin-bottom: var(--boxel-sp-xs);
        }
        .doc-heading {
          font-size: 1.5rem;
          line-height: 1.2;
          margin-bottom: var(--boxel-sp-xs);
          letter-spacing: -0.01em;
        }
        .doc-subtitle {
          line-height: 1.5;
          color: var(--muted-foreground);
          max-width: 48rem;
        }

        @media (max-width: 1024px) {
          .doc-layout {
            grid-template-columns: 1fr;
            padding: var(--boxel-sp-xs);
            overflow-y: auto;
          }
          .toc-sidebar,
          .doc-main {
            overflow-y: initial;
          }
        }

        @media (max-width: 640px) {
          .doc-layout {
            padding: var(--boxel-sp-xs);
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

  static isolated = class Isolated extends Component<typeof this> {
    private tocAppendixItems = [
      {
        id: 'available-commands',
        text: 'Available Commands',
        level: 1,
      },
    ];

    // Extract headers from markdown for TOC using shared parser
    private get markdownHeaders() {
      if (!this.args.model?.instructions) return [];
      return parseMarkdownHeaders(this.args.model.instructions);
    }

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
              @navItems={{this.markdownHeaders}}
            />
          {{/if}}
          {{#if @model.commands.length}}
            <TocSection
              @sectionTitle='Appendix'
              @navItems={{this.tocAppendixItems}}
            />
          {{/if}}
        </:navbar>
        <:default>
          {{log this.isTocEmpty}}
          {{#if @model.instructions}}
            <article
              class='instructions-article'
              id='instructions'
              {{addHeaderIds}}
            >
              <@fields.instructions />
            </article>
          {{else}}
            <div class='empty-state'>
              <FileIcon
                class='empty-icon'
                width='64'
                height='64'
                role='presentation'
              />
              <h3 class='empty-heading'>Welcome to SkillPlus</h3>
              <p class='empty-description'>This skill is currently empty. Get
                started by adding instructions.</p>
            </div>
          {{/if}}

          {{! Commands section }}
          {{#if @model.commands.length}}
            <div class='appendix-divider' id='appendix-section'>
              <h2>Appendix</h2>
            </div>
            <section class='commands-section' id='available-commands'>
              <h3 class='section-heading'>Available Commands</h3>
              <div class='commands-container'>
                <@fields.commands @format='embedded' />
              </div>
            </section>
          {{/if}}
        </:default>
      </DocLayout>

      <style scoped>
        @layer {
          /* markdown content */
          .instructions-article :deep(pre),
          .instructions-article :deep(code) {
            --code-bg: color-mix(
              in lab,
              var(--primary, var(--boxel-highlight)) 8%,
              var(--muted, var(--boxel-100))
            );
            background-color: var(--code-bg, var(--muted, var(--boxel-100)));
          }
          .instructions-article :deep(pre) {
            border-top-left-radius: 0;
            border-bottom-left-radius: 0;
            border: 1px solid var(--border, var(--boxel-border-color));
            border-left: 3px solid var(--primary, var(--boxel-highlight));
            font-size: 0.8125rem;
            line-height: 1.5;
          }
          .instructions-article :deep(h3) {
            margin-top: var(--boxel-sp-2xl);
            font-weight: 500;
          }
          .instructions-article :deep(p) {
            margin-top: var(--boxel-sp);
          }

          /* appendix */
          .appendix-divider {
            margin-top: var(--boxel-sp-5xl);
            margin-bottom: var(--boxel-sp-3xl);
            padding-block: var(--boxel-sp-xl);
            border-top: 1px solid var(--border, var(--boxel-border-color));
            border-bottom: 1px solid var(--border, var(--boxel-border-color));
          }
          .appendix-divider h2 {
            font-size: 1.5rem;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: var(--boxel-lsp-xl);
            color: var(--muted-foreground);
            text-align: center;
          }
          .commands-section {
            padding: var(--boxel-sp-lg);
            background: var(--muted, var(--boxel-100));
            border: 1px solid var(--border, var(--boxel-border-color));
            border-radius: var(--boxel-border-radius-lg);
          }
          .section-heading {
            font-size: 1.125rem;
            margin-bottom: var(--boxel-sp-lg);
          }
          .commands-container > .containsMany-field {
            display: flex;
            flex-direction: column;
            gap: var(--boxel-sp);
          }

          /* empty state */
          .empty-state {
            text-align: center;
            padding: var(--boxel-sp-4xl) var(--boxel-sp-2xl);
            max-width: 42rem;
            margin: 0 auto;
            color: var(--muted-foreground, var(--boxel-700));
          }
          .empty-icon {
            width: 4rem;
            height: 4rem;
            opacity: 0.5;
          }
          .empty-heading {
            margin-block: var(--boxel-sp-sm);
            font-size: 1.5rem;
            color: var(--foreground);
          }
          .empty-description {
            font-size: 1rem;
          }
        }
      </style>
    </template>
  };
}
