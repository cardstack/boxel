// ═══ [EDIT TRACKING: ON] Mark all changes with ⁿ ═══
import { Skill } from 'https://cardstack.com/base/skill'; // ¹ Core imports
import {
  Component,
  FieldDef,
  field,
  linksTo,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import TextAreaField from 'https://cardstack.com/base/text-area'; // ¹³⁰ TextArea import for content summary
import enumField from 'https://cardstack.com/base/enum'; // ³ Enum field import
import { on } from '@ember/modifier'; // ⁸⁰ Event modifier for TOC clicks
import { gt, eq } from '@cardstack/boxel-ui/helpers';
import { modifier } from 'ember-modifier'; // ⁿ Replacing class-based modifiers with function modifiers

// ⁿ Shared slugify used by DOM header ID assignment & TOC generation
function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ⁿ Compute table of contents markdown for a SkillSet's related skills
function computeTableOfContents(
  relatedSkills: SkillReference[] = [],
): string | undefined {
  if (relatedSkills.length === 0) return undefined;

  const tocLines: string[] = [];
  let sectionNumber = 0;

  const isFence = (line: string) => {
    if (!line) return false;
    const c = line[0];
    return (c === '`' || c === '~') && line.startsWith(c.repeat(3));
  };

  // Parse markdown heading (## or ###) into structured data
  const parseHeading = (
    line: string,
  ): { level: number; text: string; id: string } | null => {
    const match = line.match(/^(#{2,3})\s+(.+)$/);
    if (!match) return null;

    const level = match[1].length;
    let raw = match[2].trim();

    const idMatch = raw.match(/\{#([a-z0-9-]+)\}/);
    const explicitId = idMatch ? idMatch[1] : null;

    // Strip explicit ID, HTML tags, and link markdown
    raw = raw
      .replace(/\s*\{#[a-z0-9-]+\}\s*/g, '')
      .replace(/<[^>]*>/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .trim();

    const id = explicitId || slugifyHeading(raw);
    return { level, text: raw, id };
  };

  for (let i = 0; i < relatedSkills.length; i++) {
    const skillRef = relatedSkills[i];
    if (!skillRef) continue;

    sectionNumber += 1;

    const topicName = skillRef.topicName || skillRef.skill?.title || 'Untitled';
    const dividerAnchorId = `skill-divider-${i}`;
    tocLines.push(`- [**${sectionNumber}** ${topicName}](#${dividerAnchorId})`);

    const mode = skillRef.inclusionMode || 'link-only';

    const skillContent =
      skillRef.skill?.instructions && mode === 'full'
        ? skillRef.skill.instructions
        : mode === 'essential' && skillRef.essentials
        ? skillRef.essentials
        : '';

    if (!skillContent) continue;

    let inFence = false;

    for (const rawLine of skillContent.split('\n')) {
      const line = rawLine.trim();

      if (isFence(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;

      const heading = parseHeading(line);
      if (!heading) continue;

      // indent: 2 spaces per level starting from level 2
      const indent = '  '.repeat(heading.level - 1);
      tocLines.push(`${indent}- [${heading.text}](#${heading.id})`);
    }
  }

  const toc = tocLines.join('\n');
  return toc.length > 0 ? toc : undefined;
}

// ⁿ Function modifier to wrap tables in scrollable containers
const wrapTables = modifier((element: HTMLElement) => {
  const tables = element.querySelectorAll('table:not(.table-wrapper table)');
  tables.forEach((table) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
});

// ⁿ Function modifier to add IDs to headers for TOC anchor links
const addHeaderIds = modifier((element: HTMLElement) => {
  const headers = element.querySelectorAll('h2, h3, h4, h5');
  const usedIds = new Set<string>();
  headers.forEach((header) => {
    if (header.getAttribute('id')) return;
    const text = header.textContent || '';
    const idMatch = text.match(/\{#([a-z0-9-]+)\}/);
    let baseId: string;
    if (idMatch) {
      baseId = idMatch[1];
      header.textContent = text.replace(/\s*\{#[a-z0-9-]+\}\s*/, '').trim();
    } else {
      baseId = slugifyHeading(text);
    }
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

// ¹³ Inline SkillReference definition
export class SkillReference extends FieldDef {
  static displayName = 'Skill Reference';

  @field skill = linksTo(() => Skill); // ¹⁴ Link to actual skill card

  // ¹⁵ Enumerated inclusion mode with three valid options
  @field inclusionMode = contains(
    enumField(StringField, {
      options: [
        { value: 'full', label: 'Full Instructions' },
        { value: 'essential', label: 'Essential Only' },
        { value: 'link-only', label: 'Link Only' },
      ],
    }),
  );

  @field contentSummary = contains(TextAreaField, {
    // ¹³¹ Content summary (renamed from readFullWhen, using TextArea for multi-line)
    description:
      'Brief summary of what content this skill contains (helps LLM decide whether to load full instructions)',
  });

  @field alternateTitle = contains(StringField, {
    // ¹⁷ Optional override title
    description:
      "Optional: Override the linked skill's title for this reference context",
  });

  @field topicName = contains(StringField, {
    // ¹⁸ Computed topic from skill or override
    computeVia: function (this: SkillReference) {
      // return this.alternateTitle || this.skill?.title || 'Untitled Skill';
      return this.alternateTitle || 'Untitled Skill';
    },
  });

  @field essentials = contains(MarkdownField, {
    // ¹⁹ Computed essentials from skill instructions
    computeVia: function (this: SkillReference) {
      const instructions = this.skill?.instructions;
      if (!instructions) return undefined;

      // Extract content before <!--more--> marker
      const moreMarkerIndex = instructions.indexOf('<!--more-->');
      if (moreMarkerIndex === -1) {
        // No marker found, return first paragraph or section
        return instructions;
      }

      return instructions.substring(0, moreMarkerIndex).trim();
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    // ²⁰ Embedded format
    <template>
      <div class='skill-reference-card'>
        <div class='skill-ref-header'>
          <h4 class='skill-ref-topic'>
            {{if
              @model.topicName
              @model.topicName
              (if @model.skill.title @model.skill.title 'Skill')
            }}

          </h4>
          <span class='skill-ref-mode'>{{if
              @model.inclusionMode
              @model.inclusionMode
              'link-only'
            }}</span>
        </div>

        {{#if @model.skill}}
          <div class='skill-link'>
            <@fields.skill @format='atom' />
          </div>
        {{/if}}

        {{#if @model.contentSummary}}
          <div class='content-summary'>
            <strong>Contains:</strong>
            {{@model.contentSummary}}
          </div>
        {{/if}}
      </div>

      <style scoped>
        /* ⁶² Enhanced skill reference card styles */
        .skill-reference-card {
          padding: 1rem;
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          background: var(--card);
          box-shadow: var(--shadow-sm);
          transition: all 0.2s ease;
        }

        .skill-reference-card:hover {
          box-shadow: var(--shadow-md);
          border-color: var(--primary);
        }

        .skill-ref-header {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          margin-bottom: 0.75rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid var(--border);
        }

        .skill-ref-topic {
          font-size: 0.9375rem;
          font-weight: 700;
          margin: 0;
          color: var(--foreground);
        }

        .skill-ref-mode {
          font-size: 0.6875rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.125rem 0.5rem;
          border-radius: var(--radius-sm);
          background: var(--primary);
          color: var(--primary-foreground);
        }

        .skill-link {
          margin-bottom: 0.5rem;
          font-size: 0.75rem;
        }

        .content-summary {
          font-size: 0.75rem;
          color: var(--muted-foreground);
          margin-top: 0.5rem;
          padding: 0.5rem;
          background: var(--muted);
          border-radius: var(--radius-sm);
          border-left: 2px solid var(--primary);
        }

        .content-summary strong {
          color: var(--foreground);
          font-weight: 600;
        }
      </style>
    </template>
  };
}

// @ts-ignore
export class SkillSet extends Skill {
  // ² SkillSet definition
  static displayName = 'Skill Set';
  static prefersWideFormat = true; // ⁴⁰ Enable wide format for documentation

  @field relatedSkills = containsMany(SkillReference); // ²² Related skills with individual inclusion modes

  @field frontMatter = contains(MarkdownField, {
    // ²³ Editable front matter
    description:
      'Front matter content - appears at the beginning of instructions',
  });

  @field backMatter = contains(MarkdownField, {
    // ²⁴ Editable back matter
    description: 'Back matter content - appears at the end of instructions',
  });

  @field title = contains(StringField, {
    // ²⁸ Computed title from cardInfo or fallback
    computeVia: function (this: SkillSet) {
      return this.cardInfo?.title || 'Untitled Skill Set';
    },
  });

  @field tableOfContents = contains(MarkdownField, {
    // ²⁵ Computed TOC from skill sections and their headers
    computeVia: function (this: SkillSet) {
      // ⁿ Delegate to extracted function for clarity & formatter stability
      return computeTableOfContents(this.relatedSkills);
    },
  });

  @field instructions = contains(MarkdownField, {
    // ²⁶ Computed instructions with table-based skill dividers (NO TOC embedded)
    computeVia: function (this: SkillSet) {
      let result = '';

      // Add front matter
      if (this.frontMatter) {
        result += this.frontMatter + '\n\n';
      }

      const isFence = (line: string) => {
        if (!line) return false;
        const c = line[0];
        return c === '`' && line.startsWith(c.repeat(3));
      };

      // ³⁹ REMOVED: Do NOT add tableOfContents here - breaks circular dependency
      // TOC is extracted FROM instructions and displayed separately in template

      // Helper function to normalize markdown header levels
      // - Top-level becomes ## for each external skill
      // - Preserves relative depth
      // - Skips fenced code blocks (``` ... ```)
      const normalizeHeaders = (markdown: string): string => {
        if (!markdown) return markdown;

        const lines = markdown.split('\n');
        let insideFence = false;

        // Pass 1: find minimum header level outside fenced code
        let minLevel: number | undefined;
        for (let raw of lines) {
          const line = raw;
          const trimmed = line.trim();
          if (isFence(trimmed)) {
            insideFence = !insideFence;
            continue;
          }
          if (insideFence) continue;

          const m = trimmed.match(/^(#{1,6})\s+/);
          if (m) {
            const lvl = m[1].length;
            minLevel = minLevel === undefined ? lvl : Math.min(minLevel, lvl);
          }
        }

        if (minLevel === undefined) return markdown; // no headers to normalize

        const levelShift = 2 - minLevel; // ¹⁶² make top level ## (H2) for external skills

        if (levelShift === 0) return markdown;

        // Pass 2: shift headers outside fences
        insideFence = false;
        const out: string[] = [];
        for (let raw of lines) {
          const trimmed = raw.trim();
          if (isFence(trimmed)) {
            insideFence = !insideFence;
            out.push(raw);
            continue;
          }
          if (insideFence) {
            out.push(raw);
            continue;
          }

          const m = raw.match(/^(\s*)(#{1,6})\s+(.*)$/);
          if (m) {
            const leading = m[1] ?? '';
            const hashes = m[2];
            const rest = m[3] ?? '';
            const currentLevel = hashes.length;
            const newLevel = Math.max(
              2,
              Math.min(6, currentLevel + levelShift),
            );
            out.push(`${leading}${'#'.repeat(newLevel)} ${rest}`);
          } else {
            out.push(raw);
          }
        }

        return out.join('\n');
      };

      // ⁹⁰ Add related skills with numbered dividers
      if (this.relatedSkills && this.relatedSkills.length > 0) {
        for (let i = 0; i < this.relatedSkills.length; i++) {
          const skillRef = this.relatedSkills[i];
          if (!skillRef) continue;

          const sectionNumber = i + 1; // ¹⁰⁹ Number the dividers 1, 2, 3...
          const mode = skillRef.inclusionMode || 'link-only';
          const topicName =
            //  skillRef.topicName || skillRef.skill?.title || 'Untitled';
            skillRef.topicName || 'Untitled';
          const dividerAnchorId = `skill-divider-${i}`;

          const skillURL = ''; // skillRef.skill?.id ||

          // ¹¹⁰ Premium numbered divider with activation context for link-only/essential modes
          const dividerLines: string[] = [
            `<div class="skill-divider" id="${dividerAnchorId}">`,
            `  <div class="divider-number">${sectionNumber}</div>`,
            '  <div class="divider-content">',
            `    <div class="divider-topic">${topicName}</div>`,
          ];
          if (skillURL) {
            dividerLines.push(
              `    <a href="${skillURL}" class="divider-link">${skillURL}</a>`,
            );
          }
          if (skillRef.contentSummary) {
            dividerLines.push(
              `    <div class="divider-context">📖 Contains: ${skillRef.contentSummary}</div>`,
            );
          }
          dividerLines.push('  </div>', '</div>', ''); // extra "" gives a blank line

          result += dividerLines.join('\n');

          // ¹⁶³ Add skill content with header normalization
          if (mode === 'full' && skillRef.skill?.instructions) {
            result += normalizeHeaders(skillRef.skill.instructions) + '\n\n';
          } else if (mode === 'essential' && skillRef.essentials) {
            result += normalizeHeaders(skillRef.essentials) + '\n\n';
          }
        }
      }

      // Add back matter
      if (this.backMatter) {
        result += this.backMatter;
      }

      // Return pure markdown - MarkdownField will render it
      return result || undefined;
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    // ⁴¹ Professional documentation layout with responsive TOC

    // ¹⁶⁸ Extract TOC entries from markdown (unified parser)
    private parseHeadersFromMarkdown(
      markdown: string | undefined,
      headerLevel: 2 | 3,
    ): { id: string; text: string; level: number }[] {
      // ¹⁷⁹ Unified header parser
      if (!markdown) return [];

      const headers: { id: string; text: string; level: number }[] = [];
      const lines = markdown.split('\n');
      const usedIds = new Set<string>(); // ¹⁹² Track duplicate IDs like the DOM modifier

      // ¹⁸⁹ Simplified slugify function (remove emoji and special chars)
      const slugify = (text: string): string => {
        return (
          text
            .toLowerCase()
            .trim()
            // Remove emoji and special unicode characters first
            .replace(/[\u{1F300}-\u{1F9FF}]/gu, '') // Emoji ranges
            .replace(/[\u{2600}-\u{26FF}]/gu, '') // Misc symbols
            .replace(/[\u{2700}-\u{27BF}]/gu, '') // Dingbats
            .replace(/[^\w\s-]/g, '') // Non-word chars
            .replace(/\s+/g, '-') // Spaces to hyphens
            .replace(/^-+|-+$/g, '')
        ); // Trim hyphens
      };

      for (const line of lines) {
        // Match H2: "## Text {#id}" or "## Text"
        const h2Match = line.match(/^##\s+(.+)/);
        // Match H3: "### Text {#id}" or "### Text"
        const h3Match = line.match(/^###\s+(.+)/);

        if (h2Match && headerLevel === 2) {
          let fullText = h2Match[1].trim();
          // Extract explicit ID if present
          const idMatch = fullText.match(/\{#([a-z0-9-]+)\}/);
          const explicitId = idMatch ? idMatch[1] : null;
          // Remove {#id} from display text
          const rawText = fullText.replace(/\s*\{#[a-z0-9-]+\}/, '').trim();
          let baseId = explicitId || slugify(rawText);

          // ¹⁹³ Handle duplicates same as DOM modifier
          let finalId = baseId;
          let suffix = 2;
          while (usedIds.has(finalId)) {
            finalId = `${baseId}-${suffix}`;
            suffix++;
          }
          usedIds.add(finalId);

          headers.push({ id: finalId, text: rawText, level: 2 });
        } else if (h3Match) {
          let fullText = h3Match[1].trim();
          // Extract explicit ID if present
          const idMatch = fullText.match(/\{#([a-z0-9-]+)\}/);
          const explicitId = idMatch ? idMatch[1] : null;
          // Remove {#id} from display text
          const rawText = fullText.replace(/\s*\{#[a-z0-9-]+\}/, '').trim();
          let baseId = explicitId || slugify(rawText);

          // ¹⁹³ Handle duplicates same as DOM modifier
          let finalId = baseId;
          let suffix = 2;
          while (usedIds.has(finalId)) {
            finalId = `${baseId}-${suffix}`;
            suffix++;
          }
          usedIds.add(finalId);

          headers.push({ id: finalId, text: rawText, level: 3 });
        }
      }

      return headers;
    }

    // ¹⁸⁰ Extract TOC entries from frontMatter markdown (H3 only)
    get introToc() {
      return this.parseHeadersFromMarkdown(this.args.model?.frontMatter, 3);
    }

    // ¹⁸¹ Extract TOC entries from backMatter markdown (H2 and H3)
    get summaryToc() {
      return this.parseHeadersFromMarkdown(this.args.model?.backMatter, 2);
    }

    // ⁸⁰ TOC click handler - use @on modifier in template
    handleTocClick = (event: MouseEvent) => {
      // ⁸¹ Click handler method
      const target = event.target as HTMLElement | null;
      const anchor = target?.closest?.('a') as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute('href') || '';
      if (!href.startsWith('#')) return;

      event.preventDefault();
      const id = decodeURIComponent(href.slice(1));

      // Find target element by ID (escape if necessary)
      const esc = (window as any).CSS?.escape
        ? (window as any).CSS.escape(id)
        : id;
      let targetElement = document.getElementById(id) as HTMLElement | null;
      if (!targetElement) {
        targetElement = document.querySelector(
          `[id="${esc}"]`,
        ) as HTMLElement | null;
      }

      if (targetElement) {
        const scrollContainer = document.querySelector(
          '.doc-main',
        ) as HTMLElement | null;
        if (scrollContainer) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const targetRect = targetElement.getBoundingClientRect();
          const offset =
            targetRect.top - containerRect.top + scrollContainer.scrollTop - 32; // 32px offset
          scrollContainer.scrollTo({
            top: Math.max(0, offset),
            behavior: 'smooth',
          });
        } else {
          targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    };

    scrollToTop = () => {
      // ¹⁵⁸ Scroll to top handler
      const scrollContainer = document.querySelector(
        '.doc-main',
      ) as HTMLElement | null;
      if (scrollContainer) {
        scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };

    <template>
      <div class='skill-set-documentation'>
        {{! Two-column layout: TOC sidebar + main content }}
        <div class='doc-layout'>
          {{! Sticky TOC sidebar }}
          <aside class='toc-sidebar'>
            <div class='toc-header'>
              {{! ¹⁵⁶ Header with title and TOP button }}
              <h2 class='toc-title'>Table of Contents</h2>
              <button class='top-button' {{on 'click' this.scrollToTop}}>
                {{! ¹⁵⁷ TOP button }}
                ↑ TOP
              </button>
            </div>

            {{! template-lint-disable no-invalid-interactive}}
            <nav class='toc-navigation' {{on 'click' this.handleTocClick}}>
              {{! ⁸² Use @on modifier with handler }}
              {{! ¹⁷⁰ INTRO section - dynamic from frontMatter }}
              {{#if (gt this.introToc.length 0)}}
                <div class='toc-section'>
                  <div class='toc-section-title'>INTRO</div>
                  <ul>
                    {{#each this.introToc as |item|}}
                      <li><a href='#{{item.id}}'>{{item.text}}</a></li>
                    {{/each}}
                  </ul>
                </div>
              {{/if}}

              {{! ¹¹⁵ CONTENT section - computed from skills }}
              {{#if @model.tableOfContents}}
                <div class='toc-section'>
                  <div class='toc-section-title'>CONTENT</div>
                  <@fields.tableOfContents />
                </div>
              {{/if}}

              {{! ¹⁷¹ SUMMARY section - dynamic from backMatter }}
              {{#if (gt this.summaryToc.length 0)}}
                <div class='toc-section'>
                  <div class='toc-section-title'>SUMMARY</div>
                  <ul>
                    {{#each this.summaryToc as |item|}}
                      {{#if (eq item.level 2)}}
                        {{! ¹⁷⁵ H2 headers - top level }}
                        <li><a href='#{{item.id}}'>{{item.text}}</a></li>
                      {{else}}
                        {{! ¹⁷⁶ H3 headers - nested }}
                        <li class='toc-nested'><a
                            href='#{{item.id}}'
                          >{{item.text}}</a></li>
                      {{/if}}
                    {{/each}}
                  </ul>
                </div>
              {{/if}}

              {{! ¹¹⁷ APPENDIX section }}
              <div class='toc-section'>
                <div class='toc-section-title'>APPENDIX</div>
                <ul>
                  <li><a href='#skills-footer'>Related Skills</a></li>
                  {{#if (gt @model.commands.length 0)}}
                    <li><a href='#available-commands'>Available Commands</a></li>
                  {{/if}}
                </ul>
              </div>
            </nav>
          </aside>

          {{! Main content area }}
          <main class='doc-main'>
            {{! ¹³⁶ Header - metadata-style presentation }}
            <header class='doc-header'>
              <div class='metadata-label'>SKILL SET DOCUMENTATION</div>
              <h1 class='doc-heading'>{{if
                  @model.title
                  @model.title
                  'Untitled Skill Set'
                }}</h1>
              {{#if @model.description}}
                <p class='doc-subtitle'>{{@model.description}}</p>
              {{/if}}
              <div class='doc-stats'>
                <span class='stat-item'>
                  <svg
                    class='stat-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' />
                    <path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' />
                  </svg>
                  {{@model.relatedSkills.length}}
                  Skills
                </span>
                <span class='stat-item'>
                  <svg
                    class='stat-icon'
                    viewBox='0 0 24 24'
                    fill='none'
                    stroke='currentColor'
                    stroke-width='2'
                  >
                    <polyline points='22 12 18 12 15 21 9 3 6 12 2 12' />
                  </svg>
                  Composite Guide
                </span>
              </div>
            </header>

            {{! Instructions }}
            {{#if @model.instructions}}
              <article
                class='instructions-article'
                {{wrapTables}}
                {{addHeaderIds}}
              >
                {{! ⁿ Apply both function modifiers }}
                <@fields.instructions />
              </article>
            {{else}}
              <div class='empty-state'>
                <svg
                  class='empty-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <path
                    d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                  />
                  <polyline points='14 2 14 8 20 8' />
                </svg>
                <p>No instructions available. Add related skills or edit
                  front/back matter to get started.</p>
              </div>
            {{/if}}

            {{! ¹¹⁸ APPENDIX divider }}
            <div class='appendix-divider' id='appendix-section'>
              <h2>APPENDIX</h2>
            </div>

            {{! Referenced Skills footer }}
            {{#if (gt @model.relatedSkills.length 0)}}
              <footer class='skills-footer' id='skills-footer'>
                <h3 class='footer-heading'>Related Skills</h3>
                <div class='skills-cards'>
                  <@fields.relatedSkills @format='embedded' />
                </div>
              </footer>
            {{/if}}

            {{! ¹¹⁹ Available Commands section }}
            {{#if (gt @model.commands.length 0)}}
              <section class='commands-section' id='available-commands'>
                <h3 class='section-heading'>Available Commands</h3>
                <ul class='commands-list'>
                  {{#each @model.commands as |cmd|}}
                    <li class='command-item'>
                      <code>{{cmd.codeRef.module}}</code>
                      {{#if cmd.requiresApproval}}
                        <span class='approval-badge'>Requires Approval</span>
                      {{/if}}
                    </li>
                  {{/each}}
                </ul>
              </section>
            {{/if}}
          </main>
        </div>
      </div>

      <style scoped>
        /* ⁴² Professional documentation styling with reliable spacing */

        /* ⁴⁷ Root container */
        .skill-set-documentation {
          width: 100%;
          height: 100%;
          overflow: hidden;
          background: var(--background);
          color: var(--foreground);
          font-family: var(--font-sans);
        }

        /* ⁴⁸ Two-column layout with compact spacing (0.25rem base unit) */
        .doc-layout {
          display: grid;
          grid-template-columns: 240px 1fr;
          gap: 1.5rem; /* 6 × 0.25rem */
          height: 100%;
          max-width: 1600px;
          margin: 0 auto;
          padding: 1rem 1.5rem; /* 4 × 0.25rem, 6 × 0.25rem */
        }

        /* ⁴⁹ TOC Sidebar - full height scrollable navigation */
        .toc-sidebar {
          height: 100%;
          overflow-y: auto;
          overflow-x: hidden;
          background: var(--muted);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          padding: 0.75rem;
          padding-bottom: 2rem; /* ⁸⁵ Extra bottom padding */
          display: flex;
          flex-direction: column;
        }

        .toc-header {
          /* ¹⁵⁹ Header container with title and button */
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 0.75rem;
        }

        .toc-title {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
          margin: 0; /* ¹⁶⁰ Remove bottom margin, handled by header */
        }

        .top-button {
          /* ¹⁶¹ TOP button styling */
          background: var(--primary);
          color: var(--primary-foreground);
          border: none;
          border-radius: var(--radius-sm);
          padding: 0.25rem 0.5rem;
          font-size: 0.625rem;
          font-weight: 700;
          letter-spacing: 0.05em;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .top-button:hover {
          background: color-mix(in lab, var(--primary) 85%, black);
          transform: translateY(-1px);
        }

        .top-button:active {
          transform: translateY(0);
        }

        .toc-navigation {
          font-size: 0.75rem;
        }

        .toc-navigation :deep(ul) {
          list-style: none;
          padding: 0;
          margin: 0;
        }

        .toc-navigation :deep(li) {
          margin-bottom: 0.5rem; /* 2 × 0.25rem */
          padding-left: 0.75rem; /* 3 × 0.25rem */
        }

        .toc-navigation :deep(ul ul) {
          margin-top: 0.25rem; /* 1 × 0.25rem */
          padding-left: 0.75rem; /* 3 × 0.25rem */
        }

        .toc-nested {
          /* ¹⁷⁷ Nested H3 items in summary TOC */
          padding-left: 0.75rem;
        }

        .toc-navigation :deep(a) {
          color: var(--foreground);
          text-decoration: none;
          line-height: 1.5;
          transition: color 0.15s ease;
          display: inline-block;
        }

        .toc-navigation :deep(a:hover) {
          color: var(--primary);
        }

        /* ⁵⁰ Main content area - compact scrollable */
        .doc-main {
          overflow-y: auto;
          padding-right: 0.5rem; /* 2 × 0.25rem */
          padding-bottom: 3rem; /* ⁸⁶ Extra bottom padding so last section is reachable */
        }

        /* ¹³⁷ Header section - compact metadata-style presentation */
        .doc-header {
          margin-bottom: 2rem; /* ¹³⁸ Reduced from 3rem */
          padding: 0 0 1.25rem 0; /* ¹³⁸ Tighter bottom padding */
          background: transparent;
          border: none;
          border-bottom: 2px solid var(--border); /* ¹³⁸ Thinner border */
          border-radius: var(--radius-lg); /* ¹⁶⁴ Theme radius */
        }

        .metadata-label {
          font-size: 0.625rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          color: var(--primary);
          margin-bottom: 0.5rem; /* ¹³⁸ Reduced from 0.75rem */
        }

        .doc-heading {
          font-size: 1.5rem; /* ¹³⁸ Reduced from 2.25rem - much more compact */
          font-weight: 700; /* ¹³⁸ Reduced from 800 */
          line-height: 1.2;
          margin: 0 0 0.5rem 0; /* ¹³⁸ Tighter spacing */
          color: var(--foreground);
          letter-spacing: -0.01em;
        }

        .doc-subtitle {
          font-size: 0.875rem; /* ¹³⁸ Reduced from 1rem */
          line-height: 1.5;
          color: var(--muted-foreground);
          margin: 0 0 1rem 0; /* ¹³⁸ Tighter spacing */
          max-width: 48rem;
        }

        .doc-stats {
          display: flex;
          gap: 1rem; /* ¹³⁸ Reduced from 1.5rem */
          margin-top: 0.75rem; /* ¹³⁸ Reduced from 1rem */
          padding-top: 0.75rem; /* ¹³⁸ Reduced from 1rem */
          border-top: 1px solid var(--border);
        }

        .stat-item {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem; /* ¹³⁸ Reduced from 0.5rem */
          font-size: 0.75rem; /* ¹³⁸ Reduced from 0.8125rem */
          font-weight: 600;
          color: var(--muted-foreground);
        }

        .stat-icon {
          width: 1rem; /* ¹³⁸ Reduced from 1.125rem */
          height: 1rem;
          opacity: 0.7;
        }

        /* Instructions article */
        .instructions-article {
          font-size: 0.9375rem;
          line-height: 1.7;
          color: var(--foreground);
        }

        /* ⁵² Typography hierarchy - compact spacing */
        .instructions-article :deep(h2) {
          font-size: 1.375rem;
          font-weight: 700;
          line-height: 1.3;
          margin: 2rem 0 0.75rem 0; /* 8 × 0.25rem, 3 × 0.25rem */
          color: var(--foreground);
          scroll-margin-top: 6rem; /* ⁶³ Increased for sticky TOC offset */
          padding-top: 0.5rem; /* 2 × 0.25rem */
        }

        .instructions-article :deep(h2:first-child) {
          margin-top: 0;
        }

        .instructions-article :deep(h3) {
          font-size: 1.125rem;
          font-weight: 600;
          line-height: 1.4;
          margin: 1.5rem 0 0.5rem 0; /* 6 × 0.25rem, 2 × 0.25rem */
          color: var(--foreground);
          scroll-margin-top: 6rem; /* ⁶⁴ Increased for sticky TOC offset */
        }

        .instructions-article :deep(h4) {
          font-size: 1rem;
          font-weight: 600;
          line-height: 1.5;
          margin: 1rem 0 0.5rem 0; /* 4 × 0.25rem, 2 × 0.25rem */
          color: var(--foreground);
        }

        .instructions-article :deep(p) {
          margin: 0.75rem 0; /* 3 × 0.25rem */
          line-height: 1.6;
        }

        .instructions-article :deep(ul),
        .instructions-article :deep(ol) {
          margin: 0.75rem 0; /* 3 × 0.25rem */
          padding-left: 1.5rem; /* 6 × 0.25rem */
        }

        .instructions-article :deep(li) {
          margin: 0.5rem 0; /* 2 × 0.25rem */
          line-height: 1.5;
        }

        .instructions-article :deep(code) {
          font-family: var(--font-mono);
          font-size: 0.875em;
          background: var(--muted);
          background: color-mix(
            in lab,
            var(--primary) 10%,
            var(--muted)
          ); /* subtle tint */
          padding: 0.125rem 0.25rem;
          border-radius: var(--radius-sm);
          color: var(--foreground);
        }

        .instructions-article :deep(pre) {
          margin: 1rem 0; /* 4 × 0.25rem */
          padding: 0.75rem; /* 3 × 0.25rem */
          background: var(--muted);
          background: color-mix(
            in lab,
            var(--primary) 8%,
            var(--muted)
          ); /* subtle tint */
          border: 1px solid var(--border);
          border-left: 3px solid var(--primary);
          border-radius: var(--radius-md);
          overflow-x: auto;
          font-size: 0.8125rem;
          line-height: 1.5;
        }

        .instructions-article :deep(pre code) {
          background: transparent;
          padding: 0;
        }

        .instructions-article :deep(blockquote) {
          margin: 1rem 0; /* 4 × 0.25rem */
          padding: 0.75rem 1rem; /* 3 × 0.25rem, 4 × 0.25rem */
          border-left: 3px solid var(--primary);
          background: var(--muted);
          border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
          font-style: italic;
        }

        .instructions-article :deep(a) {
          color: var(--primary);
          text-decoration: none;
          transition: color 0.15s ease;
        }

        .instructions-article :deep(a:hover) {
          text-decoration: underline;
        }

        .instructions-article :deep(strong) {
          font-weight: 600;
          color: var(--foreground);
        }

        /* ¹⁴³ Table styling - clean professional tables with horizontal scroll */
        .instructions-article :deep(table) {
          width: 100%;
          max-width: 100%; /* ¹⁴⁵ Allow full width within scroll container */
          border-collapse: collapse;
          margin: 0; /* ¹⁴⁵ Margin on wrapper instead */
          font-size: 0.875rem;
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
        }

        /* ¹⁴⁵ Scrollable table wrapper */
        .instructions-article :deep(.table-wrapper) {
          width: 100%;
          max-width: 900px;
          overflow-x: auto;
          margin: 1.5rem 0;
          border-radius: var(--radius-md);
          box-shadow: var(--shadow-sm);
        }

        .instructions-article :deep(thead) {
          background: var(--muted);
          border-bottom: 2px solid var(--border);
        }

        .instructions-article :deep(th) {
          padding: 0.75rem 1rem;
          text-align: left;
          font-weight: 600;
          color: var(--foreground);
          border-right: 1px solid var(--border);
        }

        .instructions-article :deep(th:last-child) {
          border-right: none;
        }

        .instructions-article :deep(td) {
          padding: 0.625rem 1rem;
          border-right: 1px solid var(--border);
          border-bottom: 1px solid var(--border);
          vertical-align: top;
        }

        .instructions-article :deep(td:last-child) {
          border-right: none;
        }

        .instructions-article :deep(tbody tr:last-child td) {
          border-bottom: none;
        }

        .instructions-article :deep(tbody tr:hover) {
          background: color-mix(in lab, var(--primary) 5%, var(--card));
        }

        /* Code in tables */
        .instructions-article :deep(table code) {
          font-size: 0.75rem;
          white-space: nowrap;
        }

        /* ¹⁰⁷ Highlighted section - clean callout box */
        .instructions-article :deep(.highlighted-section) {
          padding: 2rem;
          margin: 2.5rem 0;
          background: var(--accent);
          border: 1px solid var(--border);
          border-radius: 12px;
        }

        /* ¹¹¹ Premium numbered skill divider - distinct from code blocks */
        .instructions-article :deep(.skill-divider) {
          margin: 4rem 0 2.5rem 0;
          padding: 2rem;
          background: var(--secondary); /* Different color than code blocks */
          color: var(--secondary-foreground);
          border: 2px solid var(--secondary);
          border-radius: var(
            --radius-xl,
            16px
          ); /* ¹⁶⁵ Theme radius with fallback */
          scroll-margin-top: 2rem;
          display: flex;
          align-items: flex-start;
          gap: 1.5rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        }

        .instructions-article :deep(.divider-number) {
          flex-shrink: 0;
          width: 3rem;
          height: 3rem;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
          font-weight: 800;
          background: var(--background);
          color: var(--foreground);
          border: 2px solid var(--border);
          border-radius: var(
            --radius-lg,
            12px
          ); /* ¹⁶⁶ Theme radius with fallback */
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .instructions-article :deep(.divider-content) {
          flex: 1;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          min-width: 0;
        }

        .instructions-article :deep(.divider-topic) {
          font-size: 1.75rem;
          font-weight: 800;
          color: var(--secondary-foreground);
          letter-spacing: -0.03em;
          line-height: 1.1;
        }

        .instructions-article :deep(.divider-link) {
          font-size: 0.6875rem;
          color: var(--secondary-foreground);
          opacity: 0.7;
          text-decoration: none;
          font-family: var(--font-mono);
          transition: opacity 0.2s ease;
          word-break: break-all;
          line-height: 1.4;
        }

        .instructions-article :deep(.divider-link:hover) {
          opacity: 1;
        }

        /* ¹¹³ Divider context text - activation conditions */
        .instructions-article :deep(.divider-context) {
          font-size: 0.6875rem; /* ¹²⁵ Smaller, aligned with link */
          color: var(--secondary-foreground);
          opacity: 0.75; /* ¹²⁶ Slightly more subtle */
          font-style: italic;
          margin-top: 0.25rem; /* ¹²⁷ Tighter spacing to link */
          line-height: 1.5;
          padding-left: 0; /* ¹²⁸ Align with link text */
        }

        /* ⁵⁵ Empty state - compact */
        .empty-state {
          text-align: center;
          padding: 3rem 1rem; /* 12 × 0.25rem, 4 × 0.25rem */
          color: var(--muted-foreground);
        }

        .empty-icon {
          width: 2rem;
          height: 2rem;
          margin: 0 auto 0.75rem; /* 3 × 0.25rem */
          opacity: 0.5;
        }

        .empty-state p {
          margin: 0;
          font-size: 0.875rem;
        }

        /* ⁵⁶ Footer with skill references - compact */
        .skills-footer {
          margin-top: 2rem; /* 8 × 0.25rem */
          padding-top: 1.5rem; /* 6 × 0.25rem */
          border-top: 2px solid var(--border);
        }

        .footer-heading {
          font-size: 1rem;
          font-weight: 700;
          margin: 0 0 1rem 0; /* 4 × 0.25rem */
          color: var(--foreground);
        }

        .skills-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 1rem; /* 4 × 0.25rem */
        }

        /* ¹²⁰ TOC section titles - uppercase labels */
        .toc-section {
          margin-bottom: 1.5rem;
        }

        .toc-section-title {
          font-size: 0.625rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.1em;
          color: var(--muted-foreground);
          margin-bottom: 0.75rem;
          padding-bottom: 0.5rem;
          border-bottom: 1px solid var(--border);
        }

        /* ¹²¹ Appendix divider - clean section break */
        .appendix-divider {
          margin: 6rem 0 3rem 0;
          padding: 2rem 0;
          border-top: 1px solid var(--border); /* ¹⁷⁸ Removed thick border for consistency */
          border-bottom: 1px solid var(--border);
        }

        .appendix-divider h2 {
          font-size: 1.5rem;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
          margin: 0;
          text-align: center;
        }

        /* ¹²² Commands section */
        .commands-section {
          margin-top: 3rem;
          padding: 2rem;
          background: var(--muted);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg); /* ¹⁶⁴ Theme radius */
        }

        .section-heading {
          font-size: 1.125rem;
          font-weight: 700;
          margin: 0 0 1rem 0;
          color: var(--foreground);
        }

        .commands-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .command-item {
          padding: 0.75rem;
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: var(--radius-md); /* ¹⁶⁴ Theme radius */
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 0.8125rem;
        }

        .command-item code {
          font-family: var(--font-mono);
          font-size: 0.75rem;
        }

        .approval-badge {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.25rem 0.5rem;
          background: var(--destructive);
          color: var(--destructive-foreground);
          border-radius: var(--radius-sm); /* ¹⁶⁴ Theme radius */
        }

        /* ⁵⁷ Responsive: Stack on smaller screens with compact spacing */
        @media (max-width: 1024px) {
          .doc-layout {
            grid-template-columns: 1fr;
            padding: 1rem; /* 4 × 0.25rem */
            gap: 1rem; /* 4 × 0.25rem */
          }

          .toc-sidebar {
            position: static;
            max-height: none;
            margin-bottom: 1rem; /* 4 × 0.25rem */
          }

          .doc-main {
            padding-right: 0;
          }
        }

        @media (max-width: 640px) {
          .doc-layout {
            padding: 0.75rem; /* 3 × 0.25rem */
          }

          .doc-heading {
            font-size: 1.5rem;
          }

          .doc-subtitle {
            font-size: 0.9375rem;
          }

          .skills-cards {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
    // ¹⁹⁴ Professional embedded format for skill set
    // ⁿ Bind modifiers for template usage
    wrapTables = wrapTables;
    addHeaderIds = addHeaderIds;

    <template>
      <div class='skill-set-embedded'>
        <div class='embedded-header'>
          <div class='skill-type-badge'>
            <svg
              class='badge-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' />
              <path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' />
            </svg>
            SKILL SET
          </div>
          <h3 class='embedded-title'>{{if
              @model.title
              @model.title
              'Untitled Skill Set'
            }}</h3>
        </div>

        {{#if @model.description}}
          <p class='embedded-description'>{{@model.description}}</p>
        {{/if}}

        {{#if (gt @model.relatedSkills.length 0)}}
          <div class='skills-summary'>
            <div class='summary-label'>Included Skills</div>
            <div class='skills-count'>{{@model.relatedSkills.length}}
              skills</div>
            <div class='skills-list'>
              {{#each @model.relatedSkills as |skillRef|}}
                <div class='skill-item'>
                  <span class='skill-bullet'>•</span>
                  <span class='skill-name'>{{if
                      skillRef.topicName
                      skillRef.topicName
                      'Untitled'
                    }}</span>
                  <span class='skill-mode'>{{if
                      skillRef.inclusionMode
                      skillRef.inclusionMode
                      'link-only'
                    }}</span>
                </div>
              {{/each}}
            </div>
          </div>
        {{else}}
          <div class='empty-skills'>
            <p>No related skills configured yet.</p>
          </div>
        {{/if}}
      </div>

      <style scoped>
        /* ¹⁹⁵ Professional embedded card styling */
        .skill-set-embedded {
          padding: 1.25rem;
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-lg);
          box-shadow: var(--shadow-sm);
        }

        .embedded-header {
          margin-bottom: 1rem;
          padding-bottom: 0.75rem;
          border-bottom: 1px solid var(--border);
        }

        .skill-type-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
          margin-bottom: 0.5rem;
        }

        .badge-icon {
          width: 0.875rem;
          height: 0.875rem;
        }

        .embedded-title {
          font-size: 1.125rem;
          font-weight: 700;
          margin: 0;
          color: var(--foreground);
          line-height: 1.3;
        }

        .embedded-description {
          font-size: 0.875rem;
          color: var(--muted-foreground);
          line-height: 1.5;
          margin: 0 0 1rem 0;
        }

        .skills-summary {
          margin-top: 1rem;
        }

        .summary-label {
          font-size: 0.6875rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
          margin-bottom: 0.5rem;
        }

        .skills-count {
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--primary);
          margin-bottom: 0.75rem;
        }

        .skills-list {
          display: flex;
          flex-direction: column;
          gap: 0.375rem;
        }

        .skill-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.75rem;
          line-height: 1.4;
        }

        .skill-bullet {
          color: var(--primary);
          font-weight: 700;
          flex-shrink: 0;
        }

        .skill-name {
          flex: 1;
          color: var(--foreground);
          font-weight: 500;
        }

        .skill-mode {
          font-size: 0.625rem;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.125rem 0.375rem;
          background: var(--muted);
          color: var(--muted-foreground);
          border-radius: var(--radius-sm);
          flex-shrink: 0;
        }

        .empty-skills {
          margin-top: 1rem;
          padding: 1rem;
          background: var(--muted);
          border-radius: var(--radius-md);
          text-align: center;
        }

        .empty-skills p {
          margin: 0;
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          font-style: italic;
        }
      </style>
    </template>
  };

  static fitted = class Fitted extends Component<typeof this> {
    // ¹⁹⁶ Professional fitted format with four sub-formats
    <template>
      <div class='fitted-container'>
        {{! ¹⁹⁷ Badge format (≤150px width, <170px height) - Compact title display }}
        <div class='badge-format'>
          <div class='badge-title'>{{if
              @model.title
              @model.title
              'Skill Set'
            }}</div>
          {{! ²⁰⁷ Show title instead of icon }}
        </div>

        {{! ¹⁹⁸ Strip format (>150px width, <170px height) - Horizontal info bar }}
        <div class='strip-format'>
          <div class='strip-left'>
            <svg
              class='strip-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' />
              <path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' />
            </svg>
            <div class='strip-title'>{{if
                @model.title
                @model.title
                'Skill Set'
              }}</div>
          </div>
          <div class='strip-count'>{{@model.relatedSkills.length}} skills</div>
        </div>

        {{! ¹⁹⁹ Tile format (<400px width, ≥170px height) - Vertical card }}
        <div class='tile-format'>
          <div class='tile-header'>
            <svg
              class='tile-icon'
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              stroke-width='2'
            >
              <path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' />
              <path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' />
            </svg>
            <div class='tile-badge'>SKILL SET</div>
          </div>
          <h4 class='tile-title'>{{if
              @model.title
              @model.title
              'Untitled'
            }}</h4>
          <div class='tile-stats'>
            <span class='stat'>{{@model.relatedSkills.length}} skills</span>
          </div>
          {{#if @model.description}}
            <p class='tile-description'>{{@model.description}}</p>
          {{/if}}
        </div>

        {{! ²⁰⁰ Card format (≥400px width, ≥170px height) - Full information }}
        <div class='card-format'>
          <div class='card-header'>
            <div class='card-meta'>
              <svg
                class='card-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' />
                <path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' />
              </svg>
              <span class='card-type'>SKILL SET</span>
            </div>
            <h4 class='card-title'>{{if
                @model.title
                @model.title
                'Untitled Skill Set'
              }}</h4>
          </div>
          {{#if @model.description}}
            <p class='card-description'>{{@model.description}}</p>
          {{/if}}
          <div class='card-footer'>
            <span class='footer-stat'>
              <svg
                class='footer-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' />
                <path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' />
              </svg>
              {{@model.relatedSkills.length}}
              skills
            </span>
          </div>
        </div>
      </div>

      <style scoped>
        /* ²⁰¹ Fitted container with size-based display */
        .fitted-container {
          container-type: size;
          width: 100%;
          height: 100%;
          background: var(--card);
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          overflow: hidden;
        }

        /* ²⁰² Hide all formats by default */
        .badge-format,
        .strip-format,
        .tile-format,
        .card-format {
          display: none;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
        }

        /* ²⁰³ Badge format - compact icon + count */
        @container (max-width: 150px) and (max-height: 169px) {
          .badge-format {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            gap: 0.25rem;
            padding: 0.375rem;
          }
        }

        .badge-title {
          /* ²⁰⁸ Badge shows title */
          font-size: clamp(0.625rem, 4%, 0.75rem);
          font-weight: 700;
          color: var(--foreground);
          text-align: center;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          line-height: 1.2;
        }

        /* ²⁰⁴ Strip format - horizontal bar */
        @container (min-width: 151px) and (max-height: 169px) {
          .strip-format {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.5rem 0.75rem;
            gap: 0.5rem;
          }
        }

        .strip-left {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          min-width: 0;
          flex: 1;
        }

        .strip-icon {
          width: 1.125rem;
          height: 1.125rem;
          color: var(--primary);
          flex-shrink: 0;
        }

        .strip-title {
          font-size: 0.875rem;
          font-weight: 600;
          color: var(--foreground);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .strip-count {
          font-size: 0.6875rem;
          font-weight: 600;
          color: var(--muted-foreground);
          flex-shrink: 0;
        }

        /* ²⁰⁵ Tile format - vertical card */
        @container (max-width: 399px) and (min-height: 170px) {
          .tile-format {
            display: flex;
            flex-direction: column;
            padding: clamp(0.5rem, 3%, 0.875rem);
            gap: 0.5rem;
          }
        }

        .tile-header {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }

        .tile-icon {
          width: 1rem;
          height: 1rem;
          color: var(--primary);
        }

        .tile-badge {
          font-size: 0.5625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
        }

        .tile-title {
          font-size: clamp(0.875rem, 4%, 1rem);
          font-weight: 700;
          margin: 0;
          color: var(--foreground);
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .tile-stats {
          display: flex;
          gap: 0.5rem;
        }

        .stat {
          font-size: 0.6875rem;
          font-weight: 600;
          color: var(--primary);
        }

        .tile-description {
          font-size: 0.6875rem;
          color: var(--muted-foreground);
          line-height: 1.4;
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
        }

        /* ²⁰⁶ Card format - full layout */
        @container (min-width: 400px) and (min-height: 170px) {
          .card-format {
            display: flex;
            flex-direction: column;
            padding: clamp(0.75rem, 3%, 1rem);
            gap: 0.75rem;
          }
        }

        .card-header {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
        }

        .card-meta {
          display: flex;
          align-items: center;
          gap: 0.375rem;
        }

        .card-icon {
          width: 1.125rem;
          height: 1.125rem;
          color: var(--primary);
        }

        .card-type {
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--muted-foreground);
        }

        .card-title {
          font-size: 1.125rem;
          font-weight: 700;
          margin: 0;
          color: var(--foreground);
          line-height: 1.3;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .card-description {
          font-size: 0.8125rem;
          color: var(--muted-foreground);
          line-height: 1.5;
          margin: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
        }

        .card-footer {
          margin-top: auto;
          padding-top: 0.75rem;
          border-top: 1px solid var(--border);
        }

        .footer-stat {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          font-size: 0.75rem;
          font-weight: 600;
          color: var(--muted-foreground);
        }

        .footer-icon {
          width: 0.875rem;
          height: 0.875rem;
        }
      </style>
    </template>
  };
}
