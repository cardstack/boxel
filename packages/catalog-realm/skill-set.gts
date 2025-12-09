import { SkillPlus, slugifyHeading, addHeaderIds } from './skill-plus';
import { SkillReference } from './skill-reference';
import {
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';

import { on } from '@ember/modifier'; // Event modifier for TOC clicks
import { bool, gt, eq, or } from '@cardstack/boxel-ui/helpers';
import { modifier } from 'ember-modifier'; // Replacing class-based modifiers with function modifiers

// Compute table of contents markdown for a Skill Set's related skills
// Updated to handle frontMatter, backMatter, and different indentation styles
function computeTableOfContents(
  relatedSkills: SkillReference[] = [],
  frontMatter?: string,
  backMatter?: string,
): string | undefined {
  const tocLines: string[] = [];
  let sectionNumber = 0;

  const isFence = (line: string) => {
    if (!line) return false;
    const c = line[0];
    return (c === '`' || c === '~') && line.startsWith(c.repeat(3));
  };

  // ²⁵⁵ Parse markdown heading (## or ###) into structured data
  // Handles headers with or without leading whitespace
  const parseHeading = (
    line: string,
  ): { level: number; text: string; id: string } | null => {
    // ²⁵⁶ Match headers with optional leading whitespace (for indented content)
    const match = line.match(/^\s*(#{2,3})\s+(.+)$/);
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

  // Helper to extract headers from markdown content
  const extractHeadersFromMarkdown = (
    content: string,
    baseIndent: number = 1,
  ): void => {
    if (!content) return;

    let inFence = false;

    for (const rawLine of content.split('\n')) {
      const line = rawLine;

      // Check for fence markers (trimmed for detection)
      if (isFence(line.trim())) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;

      const heading = parseHeading(line);
      if (!heading) continue;

      // Calculate indent based on header level relative to base
      const indent = '  '.repeat(heading.level - 2 + baseIndent);
      tocLines.push(`${indent}- [${heading.text}](#${heading.id})`);
    }
  };

  // Process frontMatter headers (if any)
  if (frontMatter) {
    extractHeadersFromMarkdown(frontMatter, 0);
  }

  // Process related skills
  for (let i = 0; i < relatedSkills.length; i++) {
    const skillRef = relatedSkills[i];
    if (!skillRef) continue;

    sectionNumber += 1;

    const topicName = skillRef.topicName || skillRef.skill?.title || 'Untitled';
    const dividerAnchorId = `skill-divider-${i}`;
    tocLines.push(`- [**${sectionNumber}** ${topicName}](#${dividerAnchorId})`);

    const mode = skillRef.inclusionMode || 'link-only';

    // ²⁶² Get skill content based on inclusion mode
    const skillContent =
      skillRef.skill?.instructions && mode === 'full'
        ? skillRef.skill.instructions
        : mode === 'essential' && skillRef.essentials
        ? skillRef.essentials
        : '';

    if (!skillContent) continue;

    // Extract headers with indent level 1 (nested under skill divider)
    let inFence = false;

    for (const rawLine of skillContent.split('\n')) {
      const line = rawLine;

      if (isFence(line.trim())) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;

      const heading = parseHeading(line);
      if (!heading) continue;

      // ²⁶⁴ Indent nested headers: 2 spaces for H2, 4 spaces for H3
      const indent = '  '.repeat(heading.level - 1);
      tocLines.push(`${indent}- [${heading.text}](#${heading.id})`);
    }
  }

  // Process backMatter headers (if any)
  if (backMatter) {
    extractHeadersFromMarkdown(backMatter, 0);
  }

  const toc = tocLines.join('\n');
  return toc.length > 0 ? toc : undefined;
}

// Function modifier to wrap tables in scrollable containers
const wrapTables = modifier((element: HTMLElement) => {
  const tables = element.querySelectorAll('table:not(.table-wrapper table)');
  tables.forEach((table) => {
    const wrapper = document.createElement('div');
    wrapper.className = 'table-wrapper';
    table.parentNode?.insertBefore(wrapper, table);
    wrapper.appendChild(table);
  });
});

export class SkillSet extends SkillPlus {
  static displayName = 'Skill Set';
  static prefersWideFormat = true; // ⁴⁰ Enable wide format for documentation

  @field title = contains(StringField, {
    computeVia: function (this: SkillSet) {
      return this.cardInfo?.title || `Untitled ${SkillSet.displayName}`;
    },
  });

  @field relatedSkills = containsMany(SkillReference); // Related skills with individual inclusion modes

  @field frontMatter = contains(MarkdownField, {
    // Editable front matter
    description:
      'Front matter content - appears at the beginning of instructions',
  });

  @field backMatter = contains(MarkdownField, {
    // Editable back matter
    description: 'Back matter content - appears at the end of instructions',
  });

  @field tableOfContents = contains(MarkdownField, {
    // Computed TOC from skill sections and their headers
    computeVia: function (this: SkillSet) {
      return computeTableOfContents(this.relatedSkills);
    },
  });

  @field instructions = contains(MarkdownField, {
    // Computed instructions with table-based skill dividers (NO TOC embedded)
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

      // REMOVED: Do NOT add tableOfContents here - breaks circular dependency
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

        const levelShift = 2 - minLevel; // make top level ## (H2) for external skills

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

      // Add related skills with numbered dividers
      if (this.relatedSkills && this.relatedSkills.length > 0) {
        for (let i = 0; i < this.relatedSkills.length; i++) {
          const skillRef = this.relatedSkills[i];
          if (!skillRef) continue;

          const sectionNumber = i + 1; // Number the dividers 1, 2, 3...
          const mode = skillRef.inclusionMode || 'link-only';
          const topicName = skillRef.topicName || 'Untitled';
          const dividerAnchorId = `skill-divider-${i}`;

          const skillURL = skillRef.skill?.id || ''; // ²³² Get skill URL

          // Premium numbered divider - NO <a href>, clickable via CSS cursor
          const dividerLines: string[] = [];

          // Add data attribute for click handler, no href wrapper
          if (skillURL) {
            dividerLines.push(
              `<div class="skill-divider skill-divider-clickable" id="${dividerAnchorId}" data-card-url="${skillURL}">`,
              `  <div class="divider-number">${sectionNumber}</div>`,
              '  <div class="divider-content">',
              `    <div class="divider-topic">${topicName}</div>`,
            );
          } else {
            dividerLines.push(
              `<div class="skill-divider" id="${dividerAnchorId}">`,
              `  <div class="divider-number">${sectionNumber}</div>`,
              '  <div class="divider-content">',
              `    <div class="divider-topic">${topicName}</div>`,
            );
          }

          if (skillRef.contentSummary) {
            const indent = '    ';
            dividerLines.push(
              `${indent}<div class="divider-context">📖 Contains: ${skillRef.contentSummary}</div>`,
            );
          }
          // Add inclusion mode badge to divider (pill-style)
          const indent = '    ';
          dividerLines.push(
            `${indent}<div class="divider-mode divider-mode-${mode}">${
              mode === 'full'
                ? 'Full'
                : mode === 'essential'
                ? 'Essential'
                : 'Link Only'
            }</div>`,
          );

          // Close divider tags (no closing </a>)
          dividerLines.push('  </div>', '</div>');

          result += '\n' + dividerLines.join('\n') + '\n\n'; // ²¹³ Blank line before HTML, two newlines after to ensure markdown parsing resumes

          // Add skill content with header normalization
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
    // Click handler for skill dividers using viewCard API
    handleDividerClick = (event: Event) => {
      const target = event.target as HTMLElement;
      const divider = target.closest('.skill-divider-clickable') as HTMLElement;

      if (divider && this.args.viewCard) {
        const cardUrl = divider.getAttribute('data-card-url');
        if (cardUrl) {
          event.preventDefault();
          event.stopPropagation();
          this.args.viewCard(new URL(cardUrl), 'isolated');
        }
      }
    };

    // Extract TOC entries from markdown (unified parser)
    private parseHeadersFromMarkdown(
      markdown: string | undefined,
      headerLevel: 2 | 3,
    ): { id: string; text: string; level: number }[] {
      // ¹⁷⁹ Unified header parser
      if (!markdown) return [];

      const headers: { id: string; text: string; level: number }[] = [];
      const lines = markdown.split('\n');
      const usedIds = new Set<string>(); // ¹⁹² Track duplicate IDs like the DOM modifier

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
          let baseId = explicitId || slugifyHeading(rawText);

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
          let baseId = explicitId || slugifyHeading(rawText);

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

    // ¹⁸⁰ Extract TOC entries from frontMatter markdown (H3s BEFORE first H2 only)
    get introToc() {
      const frontMatter = this.args.model?.frontMatter;
      if (!frontMatter) return [];

      // Find the position of the first H2 header
      const lines = frontMatter.split('\n');
      let firstH2Index = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].match(/^##\s+/)) {
          firstH2Index = i;
          break;
        }
      }

      // If no H2 found, parse all H3s; otherwise only parse content before first H2
      const contentToParse =
        firstH2Index === -1
          ? frontMatter
          : lines.slice(0, firstH2Index).join('\n');

      return this.parseHeadersFromMarkdown(contentToParse, 3);
    }

    // ¹⁸¹ Extract TOC entries from backMatter markdown (H2 and H3)
    get summaryToc() {
      return this.parseHeadersFromMarkdown(this.args.model?.backMatter, 2);
    }

    // ⁸⁰ Scroll handlers inherited from Skill
    // handleTocClick and scrollToTop are available via parent class

    <template>
      <div class='skill-set-documentation'>
        {{! Two-column layout: TOC sidebar + main content }}
        <div class='doc-layout'>
          {{! Sticky TOC sidebar }}
          <aside class='toc-sidebar'>
            <div class='toc-header'>
              {{! ¹⁵⁶ Header with title and TOP button }}
              <h2 class='toc-title'>Table of Contents</h2>
              <button class='top-button'>
                {{! ¹⁵⁷ TOP button }}
                ↑ TOP
              </button>
            </div>

            {{! template-lint-disable no-invalid-interactive}}
            <nav class='toc-navigation'>
              {{! ⁸² Use @on modifier with handler }}

              {{! Only show TOC if there's any content }}
              {{#if
                (or
                  (gt this.introToc.length 0)
                  (bool @model.tableOfContents)
                  (gt this.summaryToc.length 0)
                  (gt @model.relatedSkills.length 0)
                  (gt @model.commands.length 0)
                )
              }}

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

                {{! ¹¹⁷ APPENDIX section - only show if there's content }}
                {{#if
                  (or
                    (gt @model.relatedSkills.length 0)
                    (gt @model.commands.length 0)
                  )
                }}
                  <div class='toc-section'>
                    <div class='toc-section-title'>APPENDIX</div>
                    <ul>
                      {{#if (gt @model.relatedSkills.length 0)}}
                        <li><a href='#skills-footer'>Related Skills</a></li>
                      {{/if}}
                      {{#if (gt @model.commands.length 0)}}
                        <li><a href='#available-commands'>Available Commands</a></li>
                      {{/if}}
                    </ul>
                  </div>
                {{/if}}

              {{else}}
                {{! Empty state for TOC when no content }}
                <div class='toc-empty'>
                  <p>No content yet</p>
                </div>
              {{/if}}
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
              {{! ²⁴⁹ Apply click handler to instructions article for divider clicks }}
              <article
                class='instructions-article'
                {{wrapTables}}
                {{addHeaderIds}}
                {{on 'click' this.handleDividerClick}}
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
                <h3 class='empty-heading'>Welcome to Your Skill Set</h3>
                <p class='empty-description'>This skill set is currently empty.
                  Get started by:</p>
                <ul class='empty-actions'>
                  <li>
                    <svg
                      class='action-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path
                        d='M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7'
                      />
                      <path
                        d='M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z'
                      />
                    </svg>
                    <strong>Add Front Matter</strong>
                    – Write an introduction or overview section
                  </li>
                  <li>
                    <svg
                      class='action-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path d='M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z' />
                      <path d='M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z' />
                    </svg>
                    <strong>Add Related Skills</strong>
                    – Link existing skills to create a comprehensive guide
                  </li>
                  <li>
                    <svg
                      class='action-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <path
                        d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'
                      />
                      <polyline points='14 2 14 8 20 8' />
                      <line x1='16' y1='13' x2='8' y2='13' />
                      <line x1='16' y1='17' x2='8' y2='17' />
                      <polyline points='10 9 9 9 8 9' />
                    </svg>
                    <strong>Add Back Matter</strong>
                    – Include summary notes or reinforce key points
                  </li>
                </ul>
              </div>
            {{/if}}

            {{! ¹¹⁸ APPENDIX divider - show with content or blank slate }}
            <div class='appendix-divider' id='appendix-section'>
              <h2>APPENDIX</h2>
            </div>

            {{#if
              (or
                (gt @model.relatedSkills.length 0) (gt @model.commands.length 0)
              )
            }}
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
                  <div class='commands-container'>
                    <@fields.commands @format='embedded' />
                  </div>
                </section>
              {{/if}}
            {{else}}
              {{! Appendix blank slate }}
              <div class='appendix-empty-state'>
                <p class='appendix-empty-text'>
                  The appendix will contain related skills and available
                  commands once configured.
                </p>
              </div>
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

        .toc-empty {
          padding: 1.5rem 0.75rem;
          text-align: center;
        }

        .toc-empty p {
          margin: 0;
          font-size: 0.75rem;
          color: var(--muted-foreground);
          font-style: italic;
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

        /* ²⁵⁰ Clickable skill divider styling */
        .instructions-article :deep(.skill-divider-clickable) {
          cursor: pointer; /* ²⁵¹ Show clickable cursor */
        }

        .instructions-article :deep(.skill-divider-clickable:hover) {
          /* ²⁵² Hover state for clickable dividers */
          transform: translateY(-2px);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
        }

        /* ¹¹¹ Premium numbered skill divider - distinct from code blocks */
        .instructions-article :deep(.skill-divider) {
          margin: 4rem 0 2.5rem 0; /* ²⁵³ Margin on divider itself */
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
          transition: all 0.3s ease; /* ²³⁸ Smooth hover transitions */
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

        /* ²²⁸ Divider inclusion mode badge - pill style */
        .instructions-article :deep(.divider-mode) {
          display: inline-block;
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.375rem 0.75rem; /* ²⁴⁰ More padding for pill shape */
          border-radius: 999px; /* ²⁴¹ Full rounded pill */
          margin-top: 0.5rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1); /* ²⁴² Subtle shadow */
        }

        .instructions-article :deep(.divider-mode-full) {
          /* ²²⁹ Full mode styling - pill */
          background: var(--primary);
          color: var(--primary-foreground);
        }

        .instructions-article :deep(.divider-mode-essential) {
          /* ²³⁰ Essential mode styling - pill */
          background: var(--accent);
          color: var(--accent-foreground);
        }

        .instructions-article :deep(.divider-mode-link-only) {
          /* ²³¹ Link only mode styling - pill */
          background: var(--muted); /* ²⁴³ Better contrast */
          color: var(--muted-foreground);
          border: 1px solid var(--border);
        }

        /* ⁵⁵ Empty state - user-friendly blank slate */
        .empty-state {
          text-align: center;
          padding: 4rem 2rem;
          max-width: 42rem;
          margin: 0 auto;
          color: var(--muted-foreground);
        }

        .empty-icon {
          width: 4rem;
          height: 4rem;
          margin: 0 auto 1.5rem;
          color: var(--primary);
          opacity: 0.6;
        }

        .empty-heading {
          font-size: 1.5rem;
          font-weight: 700;
          color: var(--foreground);
          margin: 0 0 0.75rem 0;
        }

        .empty-description {
          margin: 0 0 2rem 0;
          font-size: 1rem;
          color: var(--muted-foreground);
        }

        .empty-actions {
          list-style: none;
          padding: 0;
          margin: 0;
          text-align: left;
          display: inline-block;
        }

        .empty-actions li {
          display: flex;
          align-items: flex-start;
          gap: 0.75rem;
          margin-bottom: 1.5rem;
          font-size: 0.9375rem;
          line-height: 1.6;
        }

        .empty-actions li:last-child {
          margin-bottom: 0;
        }

        .action-icon {
          width: 1.5rem;
          height: 1.5rem;
          flex-shrink: 0;
          color: var(--primary);
          margin-top: 0.125rem;
        }

        .empty-actions strong {
          color: var(--foreground);
          font-weight: 600;
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

        /* Appendix empty state */
        .appendix-empty-state {
          text-align: center;
          padding: 3rem 2rem;
          color: var(--muted-foreground);
        }

        .appendix-empty-text {
          margin: 0;
          font-size: 0.9375rem;
          font-style: italic;
          line-height: 1.6;
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

        .commands-container > .containsMany-field {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
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
