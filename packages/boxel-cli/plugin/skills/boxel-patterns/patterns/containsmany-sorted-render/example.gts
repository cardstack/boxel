import { get } from '@ember/helper';
import {
  CardDef,
  FieldDef,
  field,
  contains,
  containsMany,
  Component,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateTimeField from 'https://cardstack.com/base/datetime';

// 🧩 PATTERN: containsmany-sorted-render
//
// Render a containsMany array in a chosen order without losing the host's
// per-field rendering chrome. Sort indices in a Component getter, then
// drive {{#each}} with `<@fields.notes.[i] />`.

export class Note extends FieldDef {
  @field text = contains(StringField);
  @field createdAt = contains(DateTimeField);

  static embedded = class extends Component<typeof Note> {
    <template>
      <article class='note'>
        <time class='note-time'>{{@model.createdAt}}</time>
        <p class='note-text'>{{@model.text}}</p>
      </article>
      <style scoped>
        .note { display: grid; gap: 0.25rem; padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
        .note-time { font-size: 0.75rem; color: var(--muted-foreground); }
        .note-text { margin: 0; }
      </style>
    </template>
  };
}

export class Contact extends CardDef {
  static displayName = 'Contact';

  @field fullName = contains(StringField);
  @field email = contains(StringField);
  @field notes = containsMany(Note);

  // (cardTitle / theme not shown here for brevity — see cardinfo-override-title)

  static isolated = class extends Component<typeof Contact> {
    get sortedNoteIndexes(): number[] {
      const notes = this.args.model.notes ?? [];
      return notes
        .map((_, i) => i)
        .sort((a, b) => {
          const ta = new Date(notes[a]?.createdAt ?? 0).getTime();
          const tb = new Date(notes[b]?.createdAt ?? 0).getTime();
          return tb - ta; // newest first
        });
    }

    <template>
      <article class='contact'>
        <header>
          <h1>{{@model.fullName}}</h1>
          <p>{{@model.email}}</p>
        </header>

        <section class='notes'>
          <h2>Notes</h2>
          {{#if this.sortedNoteIndexes.length}}
            {{#each this.sortedNoteIndexes as |i|}}
              {{!--
                Crucial: render through @fields, not by passing the value.
                The host wires up edit chrome, validation, and per-item
                identity for free.

                Use {{#let (get @fields.notes i)}} not <@fields.notes.[i]>.
                The bracket form compiles fine but trips the realm-server
                lint's `no-unused-vars` rule on the `i` block param — the
                lint doesn't see `[i]` as a use of the binding. The
                {{#let (get ...)}} form makes the usage explicit and lints
                clean.
              --}}
              {{#let (get @fields.notes i) as |NoteField|}}
                <div data-note-index={{i}}>
                  <NoteField @format='embedded' />
                </div>
              {{/let}}
            {{/each}}
          {{else}}
            <p class='empty'>No notes yet.</p>
          {{/if}}
        </section>
      </article>
      <style scoped>
        .contact { display: grid; gap: 1rem; padding: 1rem; color: var(--foreground); }
        h1 { margin: 0; font-family: var(--font-sans); }
        h2 { margin: 0 0 0.5rem; font-size: 0.875rem; text-transform: uppercase; color: var(--muted-foreground); }
        .empty { color: var(--muted-foreground); }
      </style>
    </template>
  };

  static embedded = class extends Component<typeof Contact> {
    <template>
      <span class='contact-embed'>{{@model.fullName}}</span>
      <style scoped>
        .contact-embed { font-family: var(--font-sans); }
      </style>
    </template>
  };

  static fitted = class extends Component<typeof Contact> {
    <template>
      <span class='contact-fitted'>{{@model.fullName}}</span>
      <style scoped>
        .contact-fitted { padding: 0.25rem 0.5rem; }
      </style>
    </template>
  };
}
