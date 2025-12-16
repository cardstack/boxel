import {
  SkillPlus,
  slugifyHeading,
  addHeaderIds,
  DocLayout,
  TocSection,
  EmptyStateContainer,
  AppendixSection,
  parseMarkdownHeaders,
} from './skill-plus';
import { SkillReference } from './skill-reference';
import {
  Component,
  field,
  contains,
  containsMany,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';

import { gt } from '@cardstack/boxel-ui/helpers';
import { modifier } from 'ember-modifier'; // Replacing class-based modifiers with function modifiers

import SkillIcon from '@cardstack/boxel-icons/book-open';
import ActivityIcon from '@cardstack/boxel-icons/activity';
import EditIcon from '@cardstack/boxel-icons/edit';
import FileTextIcon from '@cardstack/boxel-icons/file-text';

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
      .replace(/^[\d.]+\s+/, '')
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

// Delegate click/keyboard activation for skill dividers to the container
const dividerActivation = modifier(
  (
    element: HTMLElement,
    [activate]: [(cardUrl: string, event: Event) => void],
  ) => {
    const findDivider = (target: EventTarget | null) =>
      (target as HTMLElement | null)?.closest(
        '.skill-divider-clickable',
      ) as HTMLElement | null;

    const handleClick = (event: Event) => {
      const divider = findDivider(event.target);
      const cardUrl = divider?.getAttribute('data-card-url');
      if (cardUrl) {
        activate(cardUrl, event);
      }
    };

    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      const divider = findDivider(event.target);
      const cardUrl = divider?.getAttribute('data-card-url');
      if (cardUrl) {
        event.preventDefault(); // Prevent page scroll on Space
        activate(cardUrl, event);
      }
    };

    element.addEventListener('click', handleClick);
    element.addEventListener('keydown', handleKeydown);

    return () => {
      element.removeEventListener('click', handleClick);
      element.removeEventListener('keydown', handleKeydown);
    };
  },
);

export class SkillSet extends SkillPlus {
  static displayName = 'Skill Set';
  static prefersWideFormat = true;

  @field title = contains(StringField, {
    computeVia: function (this: SkillSet) {
      return this.cardInfo?.title || `Untitled ${SkillSet.displayName}`;
    },
  });

  @field relatedSkills = containsMany(SkillReference);

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
              `<div class="skill-divider skill-divider-clickable" id="${dividerAnchorId}" data-card-url="${skillURL}" role="button" tabindex="0" aria-label="Open ${topicName}">`,
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
    // Activate skill divider via mouse or keyboard using viewCard API
    activateDivider = (cardUrl: string, event: Event) => {
      if (this.args.viewCard) {
        event.preventDefault();
        event.stopPropagation();
        this.args.viewCard(new URL(cardUrl), 'isolated');
      }
    };

    private get isTocEmpty() {
      return (
        !this.args.model?.tableOfContents &&
        !this.args.model?.frontMatter &&
        !this.args.model?.backMatter &&
        !this.hasAppendix
      );
    }

    private get hasAppendix() {
      return (
        this.args.model?.relatedSkills?.length ||
        this.args.model?.commands?.length
      );
    }

    <template>
      <DocLayout
        class='skill-set-documentation'
        @titleMeta='Skill Set Documentation'
        @title={{@model.title}}
        @description={{@model.description}}
        @hideToc={{this.isTocEmpty}}
      >
        <:navbar>
          {{#if @model.frontMatter}}
            <TocSection
              @sectionTitle='Intro'
              @navItems={{parseMarkdownHeaders @model.frontMatter}}
            />
          {{/if}}
          {{#if @model.tableOfContents}}
            <TocSection @sectionTitle='Content'>
              <@fields.tableOfContents />
            </TocSection>
          {{/if}}
          {{#if @model.backMatter}}
            <TocSection
              @sectionTitle='Summary'
              @navItems={{parseMarkdownHeaders @model.backMatter}}
            />
          {{/if}}
          {{#if this.hasAppendix}}
            <TocSection @sectionTitle='Appendix'>
              <ul>
                {{#if @model.relatedSkills.length}}
                  <li><a href='#skills-footer'>Related Skills</a></li>
                {{/if}}
                {{#if @model.commands.length}}
                  <li><a href='#available-commands'>Available Commands</a></li>
                {{/if}}
              </ul>
            </TocSection>
          {{/if}}
        </:navbar>
        <:headerRow>
          <div class='skillset-header-stats'>
            <span class='skillset-header-stat-item'>
              <SkillIcon
                class='skillset-header-stat-icon'
                width='16'
                height='16'
              />
              {{@model.relatedSkills.length}}
              Skills
            </span>
            <span class='skillset-header-stat-item'>
              <ActivityIcon
                class='skillset-header-stat-icon'
                width='16'
                height='16'
              />
              Composite Guide
            </span>
          </div>
        </:headerRow>
        <:default>
          {{#if @model.instructions}}
            <article
              class='instructions-article'
              id='instructions'
              {{addHeaderIds}}
              {{dividerActivation this.activateDivider}}
            >
              <@fields.instructions />
            </article>
          {{else}}
            <EmptyStateContainer>
              <h3>Welcome to Your Skill Set</h3>
              <p>
                This skill set is currently empty. Get started by:
              </p>
              <ul class='skillset-empty-actions'>
                <li>
                  <EditIcon width='24' height='24' />
                  <span>
                    <strong>Add Front Matter</strong>
                    <p>Write an introduction or overview section</p>
                  </span>
                </li>
                <li>
                  <SkillIcon width='24' height='24' />
                  <span>
                    <strong>Add Related Skills</strong>
                    <p>Link existing skills to create a comprehensive guide</p>
                  </span>
                </li>
                <li>
                  <FileTextIcon width='24' height='24' />
                  <span>
                    <strong>Add Back Matter</strong>
                    <p>Include summary notes or reinforce key points</p>
                  </span>
                </li>
              </ul>
            </EmptyStateContainer>
          {{/if}}

          {{#if this.hasAppendix}}
            <AppendixSection>
              {{#if @model.relatedSkills.length}}
                <section class='commands-section' id='skills-footer'>
                  <h3 class='section-heading'>Related Skills</h3>
                  <@fields.relatedSkills
                    @format='embedded'
                    class='skills-cards'
                  />
                </section>
              {{/if}}
              {{#if @model.commands.length}}
                <section class='commands-section' id='available-commands'>
                  <h3 class='section-heading'>Available Commands</h3>
                  <@fields.commands
                    @format='embedded'
                    class='commands-container'
                  />
                </section>
              {{/if}}
            </AppendixSection>
          {{/if}}
        </:default>
      </DocLayout>

      <style scoped>
        .skillset-header-stats {
          display: flex;
          gap: var(--sp-4);
          margin-block: var(--sp-3);
          padding-top: var(--sp-3);
          border-top: 1px solid var(--db-border);
        }
        .skillset-header-stat-item {
          display: inline-flex;
          align-items: center;
          gap: calc(1.5 * var(--sp-1));
          font-size: var(--boxel-font-size-xs);
          font-weight: 600;
          color: var(--db-muted-foreground);
        }
        .skillset-header-stat-icon {
          width: 1rem;
          height: 1rem;
        }

        .skillset-empty-actions {
          list-style: none;
          padding: 0;
          margin-block: var(--sp-6);
          margin-inline: 0;
          text-align: start;
          display: inline-block;
          font-size: var(--boxel-font-size-sm);
        }
        .skillset-empty-actions :deep(p) {
          font-size: inherit;
        }
        .skillset-empty-actions :deep(li) {
          display: flex;
          align-items: flex-start;
          gap: var(--sp-3);
        }
        .skillset-empty-actions :deep(li + li) {
          margin-top: var(--sp-6);
        }
        .skillset-empty-actions :deep(li svg) {
          width: 1.5rem;
          height: 1.5rem;
          flex-shrink: 0;
          margin-top: calc(0.5 * var(--sp-1));
        }
        .skillset-empty-actions :deep(strong) {
          color: var(--db-foreground);
          font-weight: 600;
        }

        /* Clickable skill divider styling */
        .instructions-article :deep(.skill-divider-clickable) {
          cursor: pointer;
        }
        .instructions-article :deep(.skill-divider-clickable:hover) {
          transform: translateY(-2px);
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
        }
        .instructions-article :deep(.skill-divider) {
          margin: 4rem 0 2.5rem 0;
          padding: 2rem;
          background: var(--secondary);
          color: var(--secondary-foreground);
          border: 2px solid var(--secondary);
          border-radius: var(--boxel-border-radius-xl, 16px);
          scroll-margin-top: 2rem;
          display: flex;
          align-items: flex-start;
          gap: 1.5rem;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
          transition: all 0.3s ease;
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
          border-radius: var(--boxel-border-radius-lg, 12px);
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }
        .instructions-article :deep(.divider-content) {
          flex: 1;
          display: flex;
          align-items: center;
          justify-content: space-between;
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
        .instructions-article :deep(.divider-context) {
          font-size: 0.6875rem;
          color: var(--secondary-foreground);
          opacity: 0.75;
          font-style: italic;
          margin-top: 0.25rem;
          line-height: 1.5;
          padding-left: 0;
        }
        /* ²²⁸ Divider inclusion mode badge - pill style */
        .instructions-article :deep(.divider-mode) {
          display: inline-block;
          font-size: 0.625rem;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          padding: 0.375rem 0.75rem;
          border-radius: 999px;
          margin-top: 0.5rem;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
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

        .skills-cards {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: var(--sp-4);
        }

        @media (max-width: 640px) {
          .skills-cards {
            grid-template-columns: 1fr;
          }
        }
      </style>
    </template>
  };

  static embedded = class Embedded extends Component<typeof this> {
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
          border-radius: var(--boxel-border-radius-lg);
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
          border-radius: var(--boxel-border-radius-sm);
          flex-shrink: 0;
        }

        .empty-skills {
          margin-top: 1rem;
          padding: 1rem;
          background: var(--muted);
          border-radius: var(--boxel-border-radius);
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
    <template>
      <div class='fitted-container'>
        {{! Badge format (≤150px width, <170px height) - Compact title display }}
        <div class='badge-format'>
          <div class='badge-title'>{{if
              @model.title
              @model.title
              'Skill Set'
            }}</div>
        </div>

        {{! Strip format (>150px width, <170px height) - Horizontal info bar }}
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

        {{! Tile format (<400px width, ≥170px height) - Vertical card }}
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

        {{! Card format (≥400px width, ≥170px height) - Full information }}
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
        /* Fitted container with size-based display */
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

        /* Strip format - horizontal bar */
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

        /* Tile format - vertical card */
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

        /* Card format - full layout */
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
