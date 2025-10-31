import { fn } from '@ember/helper';
import { gt, eq } from '@cardstack/boxel-ui/helpers';
import { Skill } from 'https://cardstack.com/base/skill';
import {
  field,
  contains,
  linksToMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import MarkdownField from 'https://cardstack.com/base/markdown';
import { Statement } from './statement';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { Button } from '@cardstack/boxel-ui/components';
import Modifier from 'ember-modifier';

interface AddHeadingIdsSignature {
  Element: Element;
  Args: {
    Named: {
      component?: any;
      statements?: Statement[];
    };
  };
}

class AddHeadingIdsModifier extends Modifier<AddHeadingIdsSignature> {
  observer: IntersectionObserver | null = null;
  component: any = null;
  statements: any[] = [];

  modify(
    element: Element,
    _positional: [],
    named: { component?: any; statements?: any[] },
  ) {
    this.component = named.component;
    this.statements = named.statements || [];

    // Wait for markdown to render, then add IDs to headings
    setTimeout(() => {
      this.addIdsToHeadings(element);
    }, 100);
  }

  addIdsToHeadings(element: Element) {
    const headings = element.querySelectorAll('h1, h2, h3, h4, h5, h6');

    // Match headings to statements and add IDs
    let statementIndex = 0;

    headings.forEach((heading) => {
      const headingText = heading.textContent?.trim() || '';

      // Try to find matching statement
      for (let i = statementIndex; i < this.statements.length; i++) {
        const stmt = this.statements[i];
        if (!stmt?.reference || !stmt?.topicName) continue;

        // Check if this heading matches the statement's topic
        const topicName = stmt.topicName.toLowerCase();
        const cleanHeading = headingText
          .toLowerCase()
          .replace(/[:#\-–—]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();

        // Match if topic name is contained in heading or vice versa
        if (
          cleanHeading.includes(topicName) ||
          topicName.includes(cleanHeading)
        ) {
          heading.id = `section-${stmt.reference}`;
          statementIndex = i + 1;
          break;
        }
      }
    });

    // Set up intersection observer
    const headingsWithIds = element.querySelectorAll('[id^="section-"]');
    if (this.component && headingsWithIds.length > 0) {
      this.setupIntersectionObserver(headingsWithIds);
    }
  }

  setupIntersectionObserver(headings: NodeListOf<Element>) {
    if (this.observer) {
      this.observer.disconnect();
    }

    const options = {
      root: null,
      rootMargin: '-100px 0px -70% 0px',
      threshold: 0,
    };

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          if (id && id.startsWith('section-')) {
            const sectionId = id.replace('section-', '');
            if (this.component) {
              this.component.activeSection = sectionId;
            }
          }
        }
      });
    }, options);

    headings.forEach((heading) => {
      if (this.observer) {
        this.observer.observe(heading);
      }
    });
  }

  cleanup() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}

class SkillFamilyIsolated extends Component<typeof SkillFamily> {
  @tracked viewMode: 'statements' | 'generated' = 'generated';
  @tracked activeSection: string | null = null;
  @tracked tocOpen = false;

  switchToStatements = () => {
    this.viewMode = 'statements';
  };

  switchToGenerated = () => {
    this.viewMode = 'generated';
  };

  @action
  toggleToc() {
    this.tocOpen = !this.tocOpen;
  }

  // Get theme CSS from cardInfo.theme or use defaults
  get cssVariables() {
    const theme = this.args.model?.cardInfo?.theme;

    // If theme exists and has cssVariables, use them directly
    if (theme?.cssVariables) {
      return theme.cssVariables;
    }

    // Fallback to default theme
    return `
        :root {
          --primary: #6366f1;
          --primary-foreground: #ffffff;
          --background: #f8fafc;
          --foreground: #0f172a;
          --card: #ffffff;
          --card-foreground: #0f172a;
          --border: #e2e8f0;
          --accent: #eef2ff;
          --muted: #f1f5f9;
          --muted-foreground: #64748b;
          --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
          --font-mono: 'JetBrains Mono', monospace;
          --radius: 0.75rem;
        }
      `;
  }

  // Extract table of contents from statements
  get tableOfContents() {
    const statements = this.args.model?.statements;
    if (!statements || statements.length === 0) return [];

    return [...statements]
      .filter((stmt) => stmt?.topicName && stmt?.reference)
      .map((stmt) => ({
        id: stmt.reference,
        title: stmt.topicName,
        level: this.getHeadingLevel(stmt.content),
      }));
  }

  getHeadingLevel(content: string | undefined): number {
    if (!content) return 2;
    const match = content.match(/^(#{1,6})\s/m);
    return match ? match[1].length : 2;
  }

  @action
  scrollToSection(id: string, event: Event) {
    event.preventDefault();

    // Set active section immediately
    this.activeSection = id;

    // Close TOC on mobile
    this.tocOpen = false;

    // Find the scroll container
    requestAnimationFrame(() => {
      const scrollContainer = document.querySelector(
        '.doc-content-wrapper',
      ) as HTMLElement;

      if (!scrollContainer) {
        console.error('Could not find scroll container');
        return;
      }

      // Check if this is the first item
      const isFirstItem = this.tableOfContents[0]?.id === id;

      if (isFirstItem) {
        // For first item, just scroll to top
        scrollContainer.scrollTo({
          top: 0,
          behavior: 'smooth',
        });
      } else {
        // For other items, find and scroll to the element
        const targetId = `section-${id}`;
        const element = document.getElementById(targetId);

        if (element) {
          const containerRect = scrollContainer.getBoundingClientRect();
          const elementRect = element.getBoundingClientRect();
          const relativeTop =
            elementRect.top - containerRect.top + scrollContainer.scrollTop;

          scrollContainer.scrollTo({
            top: Math.max(0, relativeTop - 100),
            behavior: 'smooth',
          });

          // Add highlight after scroll starts
          setTimeout(() => {
            element.classList.add('section-highlight');
            setTimeout(() => {
              element.classList.remove('section-highlight');
            }, 2500);
          }, 200);
        }
      }
    });
  }

  <template>
    <div class='skill-family-docs'>
      <header class='docs-header'>
        <div class='header-content'>
          <div class='header-left'>
            <div class='title-section'>
              <svg
                class='logo-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <path d='M12 2L2 7l10 5 10-5-10-5z' />
                <path d='M2 17l10 5 10-5' />
                <path d='M2 12l10 5 10-5' />
              </svg>
              <div class='title-text'>
                <h1>{{if
                    @model.title
                    @model.title
                    'Skill Family Documentation'
                  }}</h1>
                {{#if @model.description}}
                  <p class='subtitle'>{{@model.description}}</p>
                {{/if}}
              </div>
            </div>
          </div>

          <nav class='view-toggle' aria-label='View toggle'>
            <Button
              class='toggle-btn
                {{if (eq this.viewMode "generated") "active" ""}}'
              {{on 'click' this.switchToGenerated}}
            >
              <svg
                class='btn-icon'
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
              <span class='btn-label'>Docs</span>
            </Button>

            <Button
              class='toggle-btn
                {{if (eq this.viewMode "statements") "active" ""}}'
              {{on 'click' this.switchToStatements}}
            >
              <svg
                class='btn-icon'
                viewBox='0 0 24 24'
                fill='none'
                stroke='currentColor'
                stroke-width='2'
              >
                <rect x='3' y='3' width='7' height='7' />
                <rect x='14' y='3' width='7' height='7' />
                <rect x='14' y='14' width='7' height='7' />
                <rect x='3' y='14' width='7' height='7' />
              </svg>
              <span class='btn-label'>Statements</span>
            </Button>
          </nav>
        </div>
      </header>

      <main class='docs-main'>
        {{#if (eq this.viewMode 'statements')}}
          <div class='statements-view'>
            {{#if (gt @model.statements.length 0)}}
              <div class='statements-grid'>
                <@fields.statements @format='embedded' />
              </div>
            {{else}}
              <div class='empty-state'>
                <svg
                  class='empty-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <circle cx='12' cy='12' r='10' />
                  <line x1='12' y1='8' x2='12' y2='12' />
                  <line x1='12' y1='16' x2='12.01' y2='16' />
                </svg>
                <h3>No Statements Yet</h3>
                <p>Add statements to build your skill instructions. Each
                  statement is a modular piece that combines into the complete
                  documentation.</p>
              </div>
            {{/if}}
          </div>
        {{else}}
          <div class='doc-layout'>
            {{#if (gt this.tableOfContents.length 0)}}
              <button
                class='floating-toc-toggle'
                {{on 'click' this.toggleToc}}
                aria-label='Toggle table of contents'
                type='button'
              >
                <svg
                  class='btn-icon'
                  viewBox='0 0 24 24'
                  fill='none'
                  stroke='currentColor'
                  stroke-width='2'
                >
                  <line x1='3' y1='12' x2='21' y2='12' />
                  <line x1='3' y1='6' x2='21' y2='6' />
                  <line x1='3' y1='18' x2='21' y2='18' />
                </svg>
              </button>

              <aside class='toc-sidebar {{if this.tocOpen "open" ""}}'>
                <div class='toc-header'>
                  <div class='toc-title-row'>
                    <svg
                      class='toc-icon'
                      viewBox='0 0 24 24'
                      fill='none'
                      stroke='currentColor'
                      stroke-width='2'
                    >
                      <line x1='8' y1='6' x2='21' y2='6' />
                      <line x1='8' y1='12' x2='21' y2='12' />
                      <line x1='8' y1='18' x2='21' y2='18' />
                      <line x1='3' y1='6' x2='3.01' y2='6' />
                      <line x1='3' y1='12' x2='3.01' y2='12' />
                      <line x1='3' y1='18' x2='3.01' y2='18' />
                    </svg>
                    <h3>Contents</h3>
                  </div>
                  <div class='toc-actions'>
                    <Button
                      class='toc-close-btn'
                      {{on 'click' this.toggleToc}}
                      aria-label='Close table of contents'
                    >
                      <svg
                        class='close-icon'
                        viewBox='0 0 24 24'
                        fill='none'
                        stroke='currentColor'
                        stroke-width='2'
                      >
                        <line x1='18' y1='6' x2='6' y2='18' />
                        <line x1='6' y1='6' x2='18' y2='18' />
                      </svg>
                    </Button>
                  </div>
                </div>
                <nav class='toc-nav' aria-label='Table of contents'>
                  {{#each this.tableOfContents as |item|}}
                    <a
                      href='#{{item.id}}'
                      class='toc-link toc-level-{{item.level}}
                        {{if (eq this.activeSection item.id) "active" ""}}'
                      {{on 'click' (fn this.scrollToSection item.id)}}
                    >
                      {{item.title}}
                    </a>
                  {{/each}}
                </nav>
              </aside>
            {{/if}}

            <div class='doc-content-wrapper'>
              {{#if @model.instructions}}
                <article class='doc-content'>
                  <div
                    {{AddHeadingIdsModifier
                      component=this
                      statements=@model.statements
                    }}
                  >
                    <@fields.instructions />
                  </div>
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
                  <h3>Documentation Not Generated Yet</h3>
                  <p>Instructions will be automatically generated from your
                    statements.</p>
                </div>
              {{/if}}
            </div>
          </div>
        {{/if}}
      </main>
    </div>

    <style scoped>
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

      .skill-family-docs {
        width: 100%;
        height: 100%;
        display: flex;
        flex-direction: column;
        background: var(--background, #f8fafc);
        font-family: var(
          --font-sans,
          'Inter',
          -apple-system,
          BlinkMacSystemFont,
          sans-serif
        );
        position: relative;
        overflow: hidden;
      }

      /* Header */
      .docs-header {
        background: var(--card, #ffffff);
        border-bottom: 1px solid var(--border, #e2e8f0);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
        position: relative;
        z-index: 20;
      }

      .header-content {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        padding: 0.75rem clamp(1rem, 4vw, 2rem);
        max-width: 100%;
      }

      .header-left {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
        flex: 1;
      }

      /* Floating TOC Toggle - In doc upper left */
      .floating-toc-toggle {
        position: fixed;
        top: 1rem;
        left: 1rem;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2.5rem;
        height: 2.5rem;
        padding: 0;
        margin: 0;
        background: var(--card, #ffffff);
        border: 1px solid var(--border, #e2e8f0);
        border-radius: 0.5rem;
        cursor: pointer;
        transition: all 0.2s;
        color: var(--muted-foreground, #64748b);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
        font: inherit;
      }

      .floating-toc-toggle:hover {
        background: var(--muted, #f1f5f9);
        color: var(--foreground, #334155);
        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      }

      .floating-toc-toggle .btn-icon {
        width: 1.25rem;
        height: 1.25rem;
      }

      /* Hide toggle on desktop (sidebar always shown) */
      @media (min-width: 1024px) {
        .floating-toc-toggle {
          display: none;
        }
      }

      .title-section {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        min-width: 0;
      }

      .logo-icon {
        width: 2rem;
        height: 2rem;
        color: var(--primary, #6366f1);
        flex-shrink: 0;
      }

      .title-text {
        min-width: 0;
      }

      .title-section h1 {
        margin: 0;
        font-size: clamp(1.125rem, 3vw, 1.5rem);
        font-weight: 700;
        color: var(--foreground, #0f172a);
        letter-spacing: -0.025em;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .subtitle {
        margin: 0.125rem 0 0 0;
        font-size: 0.8125rem;
        color: var(--muted-foreground, #64748b);
        font-weight: 400;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      /* View Toggle */
      .view-toggle {
        display: flex;
        gap: 0.375rem;
        background: var(--muted, #f1f5f9);
        padding: 0.25rem;
        border-radius: 0.5rem;
        flex-shrink: 0;
      }

      .toggle-btn {
        display: inline-flex;
        align-items: center;
        gap: 0.375rem;
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
        font-weight: 500;
        color: var(--muted-foreground, #64748b);
        background: transparent;
        border: none;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.2s;
        white-space: nowrap;
      }

      .toggle-btn:hover {
        color: #475569;
        background: rgba(255, 255, 255, 0.5);
      }

      .toggle-btn.active {
        color: var(--primary, #6366f1);
        background: var(--card, #ffffff);
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
      }

      .btn-icon {
        width: 1.125rem;
        height: 1.125rem;
        flex-shrink: 0;
      }

      .btn-label {
        display: none;
      }

      /* Main Content */
      .docs-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      /* Statements View */
      .statements-view {
        padding: clamp(1rem, 3vw, 2rem);
        overflow-y: auto;
      }

      .statements-grid > .linksToMany-field {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(350px, 100%), 1fr));
        gap: 1rem;
      }

      .statements-grid
        > .linksToMany-field
        > :deep(.linksToMany-itemContainer) {
        margin-top: 0;
      }

      /* Documentation Layout - Two Column */
      .doc-layout {
        position: relative;
        display: flex;
        flex: 1;
        overflow: hidden;
        gap: 0;
      }

      /* Table of Contents Sidebar - Sticky Left Column */
      .toc-sidebar {
        position: sticky;
        top: 0;
        height: 100vh;
        width: 260px;
        min-width: 260px;
        background: var(--card, #ffffff);
        border-right: 1px solid var(--border, #e2e8f0);
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        transition:
          width 0.2s ease,
          min-width 0.2s ease;
      }

      .toc-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem 1.5rem;
        border-bottom: 1px solid var(--border, #e2e8f0);
        gap: 0.5rem;
        flex-shrink: 0;
      }

      .toc-title-row {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        min-width: 0;
      }

      .toc-icon {
        width: 1.125rem;
        height: 1.125rem;
        color: var(--primary, #6366f1);
        flex-shrink: 0;
      }

      .toc-header h3 {
        margin: 0;
        font-size: 0.875rem;
        font-weight: 600;
        color: #475569;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }

      .toc-actions {
        display: flex;
        gap: 0.25rem;
        flex-shrink: 0;
      }

      .toc-close-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        padding: 0;
        background: transparent;
        border: none;
        border-radius: 0.375rem;
        cursor: pointer;
        transition: all 0.2s;
        color: var(--muted-foreground, #64748b);
      }

      .toc-close-btn:hover {
        color: var(--foreground, #334155);
        background: var(--muted, #f1f5f9);
      }

      .close-icon {
        width: 1rem;
        height: 1rem;
      }

      .toc-nav {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 1rem;
      }

      .toc-link {
        display: block;
        padding: 0.5rem 0.75rem;
        font-size: 0.875rem;
        color: var(--muted-foreground, #64748b);
        text-decoration: none;
        border-radius: 0.375rem;
        transition: all 0.15s;
        line-height: 1.4;
        white-space: normal;
        overflow-wrap: break-word;
        word-wrap: break-word;
        cursor: pointer;
      }

      .toc-link:hover {
        background: var(--muted, #f1f5f9);
        color: var(--foreground, #334155);
      }

      .toc-link.active {
        background: var(--accent, #eef2ff);
        color: var(--primary, #6366f1);
        font-weight: 600;
        border-left: 3px solid var(--primary, #6366f1);
        padding-left: calc(0.75rem - 3px);
      }

      .toc-link.toc-level-1 {
        font-weight: 600;
        margin-top: 0.75rem;
      }

      .toc-link.toc-level-2 {
        font-weight: 500;
        padding-left: 1rem;
      }

      .toc-link.toc-level-3 {
        font-weight: 400;
        padding-left: 1.5rem;
        font-size: 0.8125rem;
      }

      .toc-link.toc-level-4,
      .toc-link.toc-level-5,
      .toc-link.toc-level-6 {
        font-weight: 400;
        padding-left: 2rem;
        font-size: 0.8125rem;
      }

      /* Documentation Content Wrapper - Narrower Responsive Column */
      .doc-content-wrapper {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        background: var(--background, #f8fafc);
        min-width: 0;
      }

      /* Documentation Content Styling - Reduced Scale */
      .doc-content {
        max-width: 42rem;
        margin: 0 auto;
        padding: clamp(1.5rem, 4vw, 3rem) clamp(1rem, 3vw, 2rem);
        font-size: 0.9375rem;
        line-height: 1.65;
        color: var(--foreground, #1e293b);
      }

      /* Improve markdown list rendering */
      .doc-content ul,
      .doc-content ol {
        margin: 1rem 0;
        padding-left: 1.5rem;
      }

      .doc-content li {
        margin: 0.5rem 0;
        line-height: 1.6;
      }

      .doc-content li::marker {
        color: var(--primary, #6366f1);
      }

      /* Fix checklist items */
      .doc-content input[type='checkbox'] {
        margin-right: 0.5rem;
      }

      /* Code blocks */
      .doc-content pre {
        margin: 1.5rem 0;
        background: #1e293b;
        border-radius: 0.5rem;
        padding: 1.25rem;
        overflow-x: auto;
        position: relative;
      }

      .doc-content pre::after {
        content: '';
        position: absolute;
        top: 0;
        right: 0;
        bottom: 0;
        width: 2rem;
        background: linear-gradient(to left, #1e293b, transparent);
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s;
      }

      .doc-content pre::-webkit-scrollbar {
        height: 8px;
      }

      .doc-content pre::-webkit-scrollbar-thumb {
        background: #475569;
        border-radius: 4px;
      }

      .doc-content code {
        font-family: var(--font-mono, 'JetBrains Mono', monospace);
        font-size: 0.8125rem;
      }

      .doc-content p code {
        background: var(--muted, #f1f5f9);
        padding: 0.125rem 0.375rem;
        border-radius: 0.25rem;
        font-size: 0.875em;
        color: var(--primary, #6366f1);
      }

      /* Tables */
      .doc-content table {
        width: 100%;
        margin: 1.5rem 0;
        border-collapse: collapse;
      }

      .doc-content th,
      .doc-content td {
        padding: 0.75rem 1rem;
        text-align: left;
        border-bottom: 1px solid var(--border, #e2e8f0);
      }

      .doc-content th {
        font-weight: 600;
        background: #f8fafc;
        color: #475569;
      }

      .doc-content tr:hover {
        background: #f8fafc;
      }

      /* Headings with anchors */
      .doc-content h1,
      .doc-content h2,
      .doc-content h3,
      .doc-content h4,
      .doc-content h5,
      .doc-content h6 {
        scroll-margin-top: 7rem;
        margin-top: 2rem;
        margin-bottom: 1rem;
      }

      /* Yellow fade highlight animation - applies to headings */
      .doc-content h1.section-highlight,
      .doc-content h2.section-highlight,
      .doc-content h3.section-highlight,
      .doc-content h4.section-highlight,
      .doc-content h5.section-highlight,
      .doc-content h6.section-highlight {
        animation: yellowFade 2.5s ease-out;
        padding: 0.75rem 1rem;
        margin-left: -1rem;
        margin-right: -1rem;
        border-radius: 0.5rem;
      }

      @keyframes yellowFade {
        0% {
          background-color: rgba(253, 224, 71, 0.7);
          box-shadow: 0 0 0 8px rgba(253, 224, 71, 0.3);
          transform: scale(1.01);
        }
        50% {
          background-color: rgba(253, 224, 71, 0.5);
        }
        100% {
          background-color: transparent;
          box-shadow: 0 0 0 0 transparent;
          transform: scale(1);
        }
      }

      .doc-content h1 {
        font-size: 1.75rem;
        font-weight: 700;
        color: var(--foreground, #0f172a);
        border-bottom: 2px solid var(--border, #e2e8f0);
        padding-bottom: 0.5rem;
        margin-top: 0;
      }

      .doc-content h2 {
        font-size: 1.375rem;
        font-weight: 600;
        color: var(--foreground, #1e293b);
      }

      .doc-content h3 {
        font-size: 1.125rem;
        font-weight: 600;
        color: var(--foreground, #334155);
      }

      .doc-content h4 {
        font-size: 1rem;
        font-weight: 600;
        color: var(--foreground, #475569);
      }

      .doc-content h5,
      .doc-content h6 {
        font-size: 0.9375rem;
        font-weight: 600;
        color: var(--foreground, #64748b);
      }

      /* Strong/Bold */
      .doc-content strong {
        font-weight: 600;
        color: var(--foreground, #0f172a);
      }

      /* Links */
      .doc-content a {
        color: var(--primary, #6366f1);
        text-decoration: none;
        border-bottom: 1px solid transparent;
        transition: border-color 0.15s;
      }

      .doc-content a:hover {
        border-bottom-color: var(--primary, #6366f1);
      }

      /* Blockquotes */
      .doc-content blockquote {
        border-left: 4px solid var(--primary, #6366f1);
        padding-left: 1rem;
        margin: 1.5rem 0;
        color: var(--muted-foreground, #64748b);
        font-style: italic;
      }

      /* Empty State */
      .empty-state {
        text-align: center;
        padding: 4rem 2rem;
      }

      .empty-icon {
        width: 4rem;
        height: 4rem;
        color: #cbd5e1;
        margin: 0 auto 1.5rem;
      }

      .empty-state h3 {
        font-size: 1.25rem;
        font-weight: 600;
        color: #475569;
        margin: 0 0 0.5rem 0;
      }

      .empty-state p {
        font-size: 0.9375rem;
        color: #64748b;
        margin: 0;
        max-width: 500px;
        margin: 0 auto;
      }

      /* Scrollbar Styling */
      .generated-view,
      .toc-sidebar {
        scrollbar-width: thin;
        scrollbar-color: #cbd5e1 #f1f5f9;
      }

      .generated-view::-webkit-scrollbar,
      .toc-sidebar::-webkit-scrollbar {
        width: 8px;
      }

      .generated-view::-webkit-scrollbar-track,
      .toc-sidebar::-webkit-scrollbar-track {
        background: #f1f5f9;
        border-radius: 4px;
      }

      .generated-view::-webkit-scrollbar-thumb,
      .toc-sidebar::-webkit-scrollbar-thumb {
        background: #cbd5e1;
        border-radius: 4px;
      }

      .generated-view::-webkit-scrollbar-thumb:hover,
      .toc-sidebar::-webkit-scrollbar-thumb:hover {
        background: #94a3b8;
      }

      /* Responsive Adjustments */
      @media (min-width: 640px) {
        .btn-label {
          display: inline;
        }

        .doc-content {
          font-size: 1rem;
        }

        .doc-content h1 {
          font-size: 2rem;
        }

        .doc-content h2 {
          font-size: 1.5rem;
        }

        .doc-content h3 {
          font-size: 1.25rem;
        }
      }

      @media (min-width: 1024px) {
        .toc-sidebar {
          width: 280px;
        }

        /* Hide close button on desktop (sidebar always shown) */
        .toc-close-btn {
          display: none;
        }

        .doc-content {
          max-width: 48rem;
        }
      }

      @media (min-width: 1280px) {
        .toc-sidebar {
          width: 300px;
        }

        .doc-content {
          max-width: 52rem;
        }
      }
    </style>
  </template>
}

export class SkillFamily extends Skill {
  static displayName = 'Skill Family';
  static prefersWideFormat = true;

  @field statements = linksToMany(Statement);

  // Computed instructions field that stitches together statements based on position
  @field instructions = contains(MarkdownField, {
    computeVia: function (this: SkillFamily) {
      try {
        if (!this.statements || this.statements.length === 0) {
          return 'No statements defined yet.';
        }

        // Build a tree structure based on position references
        const statementsArray = [...this.statements];
        const statementMap = new Map<string, any>();

        // Index all statements by their reference ID (using string keys)
        statementsArray.forEach((stmt) => {
          if (stmt?.reference) {
            statementMap.set(stmt.reference, stmt);
          }
        });

        // Find root statements (those without position or with no valid referenceId)
        const rootStatements = statementsArray.filter((stmt) => {
          if (!stmt) return false;
          return (
            !stmt.position?.referenceId ||
            !statementMap.has(stmt.position.referenceId)
          );
        });

        // Recursive function to build the document tree
        const buildTree = (
          parentRef: string | null,
          depth: number = 0,
        ): string => {
          let result = '';

          // Find statements that should follow or be inside the parent
          const children = statementsArray.filter((stmt) => {
            if (!stmt || !stmt.position?.referenceId) return false;
            return stmt.position.referenceId === parentRef;
          });

          // Sort by position type: 'inside' first, then 'follow'
          // Default to 'follow' if type is not specified
          const insideChildren = children.filter(
            (s) => s.position?.type === 'inside',
          );
          const followChildren = children.filter(
            (s) => !s.position?.type || s.position?.type === 'follow',
          );

          // Process 'inside' children first (nested content)
          insideChildren.forEach((stmt) => {
            if (stmt?.content) {
              result += stmt.content.trim() + '\n\n';
            }
            // Recursively process children of this statement
            if (stmt?.reference) {
              result += buildTree(stmt.reference, depth + 1);
            }
          });

          // Then process 'follow' children (sequential content)
          followChildren.forEach((stmt) => {
            if (stmt?.content) {
              result += stmt.content.trim() + '\n\n';
            }
            // Recursively process children of this statement
            if (stmt?.reference) {
              result += buildTree(stmt.reference, depth + 1);
            }
          });

          return result;
        };

        // Start building from root statements
        let finalInstructions = '';

        rootStatements.forEach((rootStmt) => {
          if (rootStmt?.content) {
            finalInstructions += rootStmt.content.trim() + '\n\n';
          }
          if (rootStmt?.reference) {
            finalInstructions += buildTree(rootStmt.reference);
          }
        });

        return finalInstructions.trim() || 'No content in statements.';
      } catch (e) {
        console.error('SkillFamily: Error computing instructions', e);
        return 'Error generating instructions.';
      }
    },
  });

  static isolated = SkillFamilyIsolated;
}
