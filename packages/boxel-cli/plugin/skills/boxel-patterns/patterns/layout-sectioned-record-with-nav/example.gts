// Distilled example for `layout-sectioned-record-with-nav`.
//
// One long-record CardDef + two section FieldDefs. The isolated layout has
// a sticky 220px nav rail (one button per section + a click-to-scroll
// handler that sets @tracked activeSection) and a main content stack with
// stable section ids.
//
// Full real-world implementations have 5–6 sections (Identity / Medical /
// Family / Custody / Financial / IEP, or whatever the domain shape is) +
// a header band + a badge cluster + an optional linked-stub preview.
// This example keeps two sections for clarity.
import {
  CardDef,
  Component,
  FieldDef,
  field,
  contains,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { eq } from '@cardstack/boxel-ui/helpers';

// ─── Section FieldDefs (sibling file in production: profile-sections.gts) ───
class IdentitySection extends FieldDef {
  static displayName = 'Identity';

  @field recordId  = contains(StringField);
  @field firstName = contains(StringField);
  @field lastName  = contains(StringField);
  @field preferredName = contains(StringField);
  @field dateOfBirth = contains(DateField);

  @field displayName = contains(StringField, {
    computeVia: function (this: IdentitySection) {
      return [this.firstName, this.lastName].filter(Boolean).join(' ') || 'Untitled';
    },
  });
  @field initials = contains(StringField, {
    computeVia: function (this: IdentitySection) {
      const f = this.firstName?.[0] ?? '', l = this.lastName?.[0] ?? '';
      return (f + l).toUpperCase() || '??';
    },
  });

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <section class='section identity-section'>
        <h2 class='section-title'>Identity</h2>
        <dl class='section-grid'>
          <dt>Record ID</dt> <dd>{{@model.recordId}}</dd>
          <dt>Name</dt>      <dd>{{@model.displayName}}</dd>
          {{#if @model.preferredName}}
            <dt>Preferred</dt> <dd>{{@model.preferredName}}</dd>
          {{/if}}
          {{#if @model.dateOfBirth}}
            <dt>Date of Birth</dt> <dd><@fields.dateOfBirth /></dd>
          {{/if}}
        </dl>
      </section>
      <style scoped>
        .section { padding: 1.5rem 0; border-bottom: 1px solid var(--border, var(--boxel-200)); }
        .section-title { margin: 0 0 0.75rem; font-size: 1.125rem; }
        .section-grid { display: grid; grid-template-columns: 8rem 1fr; gap: 0.5rem 1rem; }
        .section-grid dt { color: var(--muted-foreground, var(--boxel-600)); font-size: 0.875rem; }
        .section-grid dd { margin: 0; }
      </style>
    </template>
  };
}

class NotesSection extends FieldDef {
  static displayName = 'Notes';

  @field summary = contains(StringField);
  @field detail  = contains(StringField);

  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <section class='section notes-section'>
        <h2 class='section-title'>Notes</h2>
        {{#if @model.summary}}<p class='lead'>{{@model.summary}}</p>{{/if}}
        {{#if @model.detail}}<p>{{@model.detail}}</p>{{/if}}
      </section>
      <style scoped>
        .section { padding: 1.5rem 0; border-bottom: 1px solid var(--border, var(--boxel-200)); }
        .section-title { margin: 0 0 0.75rem; font-size: 1.125rem; }
        .lead { font-weight: 500; }
      </style>
    </template>
  };
}

// ─── Long record with sectioned nav layout ──────────────────────────
export class SectionedRecord extends CardDef {
  static displayName = 'Sectioned Record';
  static prefersWideFormat = true; // 220px rail needs the width

  @field identity = contains(IdentitySection);
  @field notes    = contains(NotesSection);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: SectionedRecord) {
      return this.identity?.displayName || 'Untitled Record';
    },
  });

  static isolated = class Isolated extends Component<typeof this> {
    @tracked activeSection = 'identity';

    sections = [
      { id: 'identity', label: 'Identity', icon: 'user' },
      { id: 'notes',    label: 'Notes',    icon: 'document' },
    ];

    scrollToSection = (sectionId: string) => {
      this.activeSection = sectionId;
      const element = document.getElementById(`section-${sectionId}`);
      element?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    <template>
      <article class='record'>
        <div class='record-layout'>
          {{!-- Sticky left rail --}}
          <nav class='record-nav'>
            <div class='nav-header'>
              <div class='nav-avatar'>{{@model.identity.initials}}</div>
              <div class='nav-info'>
                <span class='nav-name'>{{@model.cardTitle}}</span>
                <span class='nav-id'>{{@model.identity.recordId}}</span>
              </div>
            </div>
            <div class='nav-sections'>
              {{#each this.sections as |section|}}
                <button
                  class='nav-btn {{if (eq this.activeSection section.id) "active"}}'
                  type='button'
                  {{on 'click' (fn this.scrollToSection section.id)}}
                >
                  {{!-- Icon switch by section.icon — keep an if/else chain for ≤10 icons. --}}
                  {{#if (eq section.icon 'user')}}
                    <svg viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='2'>
                      <circle cx='12' cy='8' r='4' /><path d='M4 20c0-4 4-6 8-6s8 2 8 6' />
                    </svg>
                  {{else if (eq section.icon 'document')}}
                    <svg viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='2'>
                      <path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z' />
                      <path d='M14 2v6h6' />
                    </svg>
                  {{/if}}
                  <span>{{section.label}}</span>
                </button>
              {{/each}}
            </div>
          </nav>

          {{!-- Main content --}}
          <main class='record-main'>
            <header class='record-header'>
              <div class='header-avatar'>{{@model.identity.initials}}</div>
              <div class='header-info'>
                <h1 class='header-name'>{{@model.cardTitle}}</h1>
                <span class='header-id'>{{@model.identity.recordId}}</span>
              </div>
            </header>

            <div id='section-identity' class='section-anchor'>
              <@fields.identity @format='embedded' />
            </div>
            <div id='section-notes' class='section-anchor'>
              <@fields.notes @format='embedded' />
            </div>
          </main>
        </div>
      </article>

      <style scoped>
        .record { background: var(--background, white); color: var(--foreground, #111); }
        .record-layout {
          display: grid;
          grid-template-columns: 220px 1fr;
          min-height: 100vh;
        }
        .record-nav {
          position: sticky;
          top: 0;
          height: 100vh;
          overflow-y: auto;
          padding: 1.25rem;
          background: var(--surface-0, var(--background));
          border-right: 1px solid var(--border, var(--boxel-200));
          display: flex; flex-direction: column; gap: 1.25rem;
        }
        .nav-header { display: flex; gap: 0.5rem; align-items: center; }
        .nav-avatar {
          width: 36px; height: 36px;
          border-radius: 50%;
          background: var(--primary, var(--boxel-purple-300));
          color: white;
          display: flex; align-items: center; justify-content: center;
          font-weight: 600; font-size: 0.875rem;
        }
        .nav-info { display: flex; flex-direction: column; min-width: 0; }
        .nav-name { font-weight: 600; font-size: 0.875rem; }
        .nav-id { font-size: 0.75rem; color: var(--muted-foreground, var(--boxel-600)); }
        .nav-sections { display: flex; flex-direction: column; gap: 0.125rem; }
        .nav-btn {
          display: flex; align-items: center; gap: 0.5rem;
          width: 100%; padding: 0.5rem 0.75rem;
          background: transparent; border: 0; border-radius: var(--radius-md, var(--boxel-border-radius));
          text-align: left; cursor: pointer;
          font-size: 0.875rem; color: inherit;
        }
        .nav-btn:hover { background: var(--surface-2, var(--boxel-100)); }
        .nav-btn.active {
          background: var(--primary, var(--boxel-purple-100));
          color: var(--primary-foreground, var(--boxel-purple-900));
          font-weight: 600;
        }
        .record-main { padding: 1.5rem 2rem; max-width: 56rem; }
        .record-header { display: flex; gap: 1rem; align-items: center; margin-bottom: 1rem; }
        .header-avatar {
          width: 64px; height: 64px;
          border-radius: var(--radius-md, var(--boxel-border-radius));
          background: var(--primary, var(--boxel-purple-300));
          color: white;
          display: flex; align-items: center; justify-content: center;
          font-weight: 600; font-size: 1.25rem;
        }
        .header-name { margin: 0; font-size: 1.5rem; }
        .header-id { font-size: 0.875rem; color: var(--muted-foreground, var(--boxel-600)); }
        .section-anchor { scroll-margin-top: 1rem; }
      </style>
    </template>
  };
}
