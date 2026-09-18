import { CardDef, field, contains, Component } from '@cardstack/base/card-api';
import StringField from '@cardstack/base/string';
import MarkdownField from '@cardstack/base/markdown';

// 🧩 PATTERN: Theme-first workflow.
//
// Step 0 (before writing this file): decide whether Boxel defaults are enough.
// Step 1 (only if a specific Theme is wanted): link cardInfo.theme to it.
// Step 2 (in this template): use theme tokens exclusively.
// Step 3: preview to verify.

// === The CardDef ======================================================

export class BlogPost extends CardDef {
  static displayName = 'Blog Post';

  @field headline = contains(StringField);
  @field body     = contains(MarkdownField);

  // The canonical cardTitle override — respects user-entered cardInfo.name first,
  // then falls back to the primary field, then to the default.
  @field cardTitle = contains(StringField, {
    computeVia: function (this: BlogPost) {
      return this.cardInfo?.name?.trim()?.length
        ? this.cardInfo.name
        : (this.headline ?? `Untitled ${this.constructor.displayName}`);
    },
  });

  static isolated = class extends Component<typeof BlogPost> {
    <template>
      <article class='post'>
        <h1>{{@model.cardTitle}}</h1>
        <main class='body'>
          <@fields.body />
        </main>
      </article>

      <style scoped>
        /*
          🎯 All chrome reads from theme tokens. theme.css supplies
          their defaults; a Theme linked at cardInfo.theme can override them.
          No hard-coded colors or fonts.
        */
        .post {
          background: var(--card);
          color: var(--card-foreground);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          padding: 2rem;
          font-family: var(--font-sans);
        }

        .post h1 {
          color: var(--foreground);
          margin: 0 0 1rem;
        }

        .body {
          color: var(--muted-foreground);
          line-height: 1.7;
        }

        /* Links inherit the theme's accent */
        .body :global(a) {
          color: var(--accent);
        }
      </style>
    </template>
  };
}

// === Companion JSON instance ==========================================
//
// File: <realm>/BlogPost/welcome-post.json
//
// {
//   "data": {
//     "type": "card",
//     "attributes": {
//       "headline": "Welcome to the blog",
//       "body": "First post body in markdown…"
//     },
//     "relationships": {
//       "cardInfo.theme": {
//         "links": { "self": "../Theme/modern-magazine" }
//       }
//     },
//     "meta": {
//       "adoptsFrom": {
//         "module": "../blog-post",
//         "name": "BlogPost"
//       }
//     }
//   }
// }
//
// 🎯 The optional "cardInfo.theme" relationship key includes the dot.
//    Omit the relationship when no specific Theme is wanted. If an explicit
//    empty link is needed, use "self": null — never [] (that's linksToMany).
