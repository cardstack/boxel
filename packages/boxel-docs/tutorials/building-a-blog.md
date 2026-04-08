# Tutorial: Building a Blog

Build a blog application using Boxel cards — with posts, authors, categories, and a blog app with filtering and sorting.

## Card Definitions

### Author Card

```typescript
// author.gts
import { CardDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Author extends CardDef {
  static displayName = 'Author';

  @field name = contains(StringField);
  @field bio = contains(StringField);
  @field avatarUrl = contains(StringField);

  static embedded = class extends Component<typeof Author> {
    <template>
      <div class="author-embed">
        {{#if @model.avatarUrl}}
          <img src={{@model.avatarUrl}} alt={{@model.name}} class="avatar" />
        {{/if}}
        <span><@fields.name /></span>
      </div>
      <style scoped>
        .author-embed { display: flex; align-items: center; gap: var(--boxel-sp-xs); }
        .avatar { width: 1.5rem; height: 1.5rem; border-radius: 50%; object-fit: cover; }
      </style>
    </template>
  };
}
```

### Category Card

```typescript
// category.gts
import { CardDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';

export class Category extends CardDef {
  static displayName = 'Category';

  @field name = contains(StringField);
  @field color = contains(StringField);

  static atom = class extends Component<typeof Category> {
    <template>
      <span class="category-tag" style="background: {{@model.color}}">
        {{@model.name}}
      </span>
      <style scoped>
        .category-tag {
          padding: 0.125rem 0.5rem;
          border-radius: 1rem;
          font-size: var(--boxel-font-size-xs);
          color: white;
        }
      </style>
    </template>
  };
}
```

### Blog Post Card

```typescript
// blog-post.gts
import {
  CardDef, field, contains, linksTo, linksToMany, Component
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import MarkdownField from 'https://cardstack.com/base/markdown';
import DateField from 'https://cardstack.com/base/date';
import BooleanField from 'https://cardstack.com/base/boolean';
import { Author } from './author';
import { Category } from './category';

export class BlogPost extends CardDef {
  static displayName = 'Blog Post';
  static prefersWideFormat = true;

  @field title = contains(StringField);
  @field body = contains(MarkdownField);
  @field excerpt = contains(StringField);
  @field publishDate = contains(DateField);
  @field coverImageUrl = contains(StringField);
  @field isPublished = contains(BooleanField);
  @field author = linksTo(Author);
  @field categories = linksToMany(Category);

  @field readingTime = contains(StringField, {
    computeVia: function(this: BlogPost) {
      const words = (this.body ?? '').split(/\s+/).length;
      const minutes = Math.max(1, Math.round(words / 200));
      return `${minutes} min read`;
    }
  });

  static isolated = class extends Component<typeof BlogPost> {
    <template>
      <article class="blog-post">
        {{#if @model.coverImageUrl}}
          <img src={{@model.coverImageUrl}} alt={{@model.title}} class="cover" />
        {{/if}}
        <header>
          <div class="categories"><@fields.categories /></div>
          <h1><@fields.title /></h1>
          <div class="meta">
            <@fields.author /> · <@fields.publishDate /> · {{@model.readingTime}}
          </div>
        </header>
        <div class="body"><@fields.body /></div>
      </article>
      <style scoped>
        .blog-post {
          max-width: 48rem;
          margin: 0 auto;
          padding: var(--boxel-sp-lg);
          font-family: var(--boxel-font-family);
        }
        .cover {
          width: 100%;
          max-height: 20rem;
          object-fit: cover;
          border-radius: var(--boxel-border-radius-lg);
          margin-bottom: var(--boxel-sp-lg);
        }
        h1 { font-size: 2rem; margin: var(--boxel-sp-sm) 0; }
        .meta { color: var(--boxel-400); margin-bottom: var(--boxel-sp-xl); }
        .categories { display: flex; gap: var(--boxel-sp-xxs); }
        .body { line-height: 1.7; }
      </style>
    </template>
  };

  static embedded = class extends Component<typeof BlogPost> {
    <template>
      <div class="post-card">
        {{#if @model.coverImageUrl}}
          <img src={{@model.coverImageUrl}} alt="" class="thumb" />
        {{/if}}
        <div class="info">
          <h3><@fields.title /></h3>
          <p>{{@model.excerpt}}</p>
          <span class="meta">{{@model.readingTime}}</span>
        </div>
      </div>
      <style scoped>
        .post-card {
          display: flex;
          gap: var(--boxel-sp);
          padding: var(--boxel-sp-sm);
        }
        .thumb {
          width: 5rem; height: 5rem;
          object-fit: cover;
          border-radius: var(--boxel-border-radius);
          flex-shrink: 0;
        }
        h3 { margin: 0 0 var(--boxel-sp-xxs); font-size: 1rem; }
        p { margin: 0; color: var(--boxel-400); font-size: var(--boxel-font-size-sm); }
        .meta { font-size: var(--boxel-font-size-xs); color: var(--boxel-400); }
      </style>
    </template>
  };
}
```

### Blog App Card

```typescript
// blog-app.gts
import {
  CardDef, field, linksToMany, Component
} from 'https://cardstack.com/base/card-api';
import { BlogPost } from './blog-post';

export class BlogApp extends CardDef {
  static displayName = 'Blog';
  static prefersWideFormat = true;

  @field posts = linksToMany(() => BlogPost, {
    query: {
      filter: {
        every: [
          { type: { module: './blog-post', name: 'BlogPost' } },
          { eq: { isPublished: true } }
        ]
      },
      sort: [{ by: 'publishDate', direction: 'desc' }]
    }
  });

  static isolated = class extends Component<typeof BlogApp> {
    <template>
      <div class="blog-app">
        <header class="blog-header">
          <h1>My Blog</h1>
          <p>Thoughts and writings</p>
        </header>
        <div class="posts-grid">
          <@fields.posts />
        </div>
      </div>
      <style scoped>
        .blog-app {
          max-width: 64rem;
          margin: 0 auto;
          padding: var(--boxel-sp-xl);
        }
        .blog-header {
          text-align: center;
          margin-bottom: var(--boxel-sp-xxl);
        }
        .blog-header h1 { font-size: 2.5rem; margin: 0; }
        .blog-header p { color: var(--boxel-400); }
        .posts-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(20rem, 1fr));
          gap: var(--boxel-sp-lg);
        }
      </style>
    </template>
  };
}
```

## Key Concepts Demonstrated

- **Query-based linksToMany** — Auto-populate published posts sorted by date
- **Computed fields** — Reading time calculation
- **Multi-format rendering** — Isolated (full article), embedded (card), atom (chip)
- **Markdown content** — Rich text with MarkdownField
- **Card relationships** — Author, categories linked to posts

## Next Steps

- [Building a CRM](/tutorials/building-a-crm) — More complex app
- [Themes & Customization](/tutorials/themes-and-customization) — Styling
- [Patterns & Best Practices](/tutorials/patterns) — Advanced patterns
