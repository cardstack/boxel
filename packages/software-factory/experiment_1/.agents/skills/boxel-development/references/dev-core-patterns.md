**Card with computed title:**
```gts
export class BlogPost extends CardDef {
  @field headline = contains(StringField);
  
  @field title = contains(StringField, {
    computeVia: function(this: BlogPost) {
      return this.headline ?? 'Untitled Post';
    }
  });
}
```

**Field definition:**
```gts
export class AddressField extends FieldDef {
  @field street = contains(StringField);
  @field city = contains(StringField);
  
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class="address">
        <@fields.street /> <@fields.city />
      </div>
    </template>
  };
}
```

## Core Patterns

### 1. Card Definition with Safe Computed Title
```gts
import { CardDef, field, contains, linksTo, containsMany, linksToMany, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import DateField from 'https://cardstack.com/base/date';
import FileTextIcon from '@cardstack/boxel-icons/file-text';
import { Author } from './author';

export class BlogPost extends CardDef {
  static displayName = 'Blog Post';
  static icon = FileTextIcon; // ✅ CORRECT: Boxel icons for static card/field type icons
  static prefersWideFormat = true;
  
  @field headline = contains(StringField);
  @field publishDate = contains(DateField);
  @field author = linksTo(Author);
  @field tags = containsMany(TagField);
  @field relatedPosts = linksToMany(() => BlogPost);
  
  @field title = contains(StringField, {
    computeVia: function(this: BlogPost) {
      try {
        const baseTitle = this.headline ?? 'Untitled Post';
        const maxLength = 50;
        if (baseTitle.length <= maxLength) return baseTitle;
        return baseTitle.substring(0, maxLength - 3) + '...';
      } catch (e) {
        console.error('BlogPost: Error computing title', e);
        return 'Untitled Post';
      }
    }
  });
}
```

### 2. Field Definition (Always Include Embedded Template)

**CRITICAL:** Every FieldDef file must import FieldDef and MUST be exported:

```gts
import { FieldDef, field, contains, Component } from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import LocationIcon from '@cardstack/boxel-icons/map-pin';
import { concat } from '@ember/helper';

export class AddressField extends FieldDef {
  static displayName = 'Address';
  static icon = LocationIcon; // ✅ CORRECT: Boxel icons for static card/field type icons
  
  @field street = contains(StringField);
  @field city = contains(StringField);
  @field postalCode = contains(StringField);
  @field country = contains(StringField);
  
  static embedded = class Embedded extends Component<typeof this> {
    <template>
      <div class="address">
        {{#if @model.street}}
          <div><@fields.street /></div>
        {{else}}
          <div class="placeholder">Street address not provided</div>
        {{/if}}
        <div>
          {{if @model.city @model.city "City"}}{{if @model.postalCode (concat ", " @model.postalCode) ""}}
        </div>
        {{#if @model.country}}
          <div><@fields.country /></div>
        {{else}}
          <div class="placeholder">Country not specified</div>
        {{/if}}
      </div>
      <style scoped>
        .placeholder { font-style: italic; }
      </style>
    </template>
  };
}
```

### 3. Computed Properties with Safety

**CRITICAL:** Avoid cycles and infinite recursion in computed fields.

```gts
// ❌ DANGEROUS: Self-reference causes infinite recursion
@field title = contains(StringField, {
  computeVia: function(this: BlogPost) {
    return this.title || 'Untitled'; // STACK OVERFLOW!
  }
});

// ✅ SAFE: Reference only base fields
@field fullName = contains(StringField, {
  computeVia: function(this: Person) {
    try {
      const first = this.firstName ?? '';
      const last = this.lastName ?? '';
      const full = first + ' ' + last;
      return full.trim() || 'Name not provided';
    } catch (e) {
      console.error('Person: Error computing fullName', e);
      return 'Name unavailable';
    }
  }
});
```

### 4. Templates with Proper Computation Patterns

**Remember:** When implementing templates via SEARCH/REPLACE, track all major sections with ⁿ and include the post-block notation `╰ ⁿ⁻ᵐ`

```gts
static isolated = class Isolated extends Component<typeof BlogPost> { // ³⁰ Isolated format
  @tracked showComments = false;
  
  // ³¹ CRITICAL: Do ALL computation in functions, never in templates
  get safeTitle() {
    try {
      return this.args?.model?.title ?? 'Untitled Post';
    } catch (e) {
      console.error('BlogPost: Error accessing title', e);
      return 'Untitled Post';
    }
  }
  
  get commentButtonText() {
    try {
      const count = this.args?.model?.commentCount ?? 0;
      return this.showComments ? `Hide Comments (${count})` : `Show Comments (${count})`;
    } catch (e) {
      console.error('BlogPost: Error computing comment button text', e);
      return this.showComments ? 'Hide Comments' : 'Show Comments';
    }
  }
  
  // methods referenced from templates must be defined with fat arrow (=>) so that they are properly bound when invoked
  toggleComments = () => {
    this.showComments = !this.showComments;
  }
  
  <template>
    <!-- ³² Responsive surface that adapts from wide layouts down to mobile -->
    <article class="blog-post-surface">
      <header>
        <time>{{if @model.publishDate (formatDateTime @model.publishDate 'MMMM D, YYYY') "Date not set"}}</time>
        <h1>{{this.safeTitle}}</h1>
        
        {{#if @fields.author}}
          <@fields.author />
        {{else}}
          <div class="author-placeholder">Author not specified</div>
        {{/if}}
      </header>
      
      <div class="post-content">
        {{#if @model.body}}
          <@fields.body />
        {{else}}
          <div class="content-placeholder">
            <p>No content has been written yet. Click to start writing!</p>
          </div>
        {{/if}}
      </div>
      
      <!-- ³³ Handle arrays with REQUIRED spacing -->
      {{#if (gt @model.tags.length 0)}}
        <section class="tags-section">
          <h4>Tags</h4>
          <div class="tags-container">
            <@fields.tags @format="atom" />
          </div>
        </section>
      {{/if}}
      
      {{#if (gt @model.commentCount 0)}}
      <div>
        <Button 
          @kind="text-only" 
          @size="extra-small" 
          class="comment-button"
          {{on 'click' this.toggleComments}}
        >
          <svg width='16' height='16' class="button-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          {{this.commentButtonText}}
        </Button>
       </div>
      {{/if}}
      
      {{#if this.showComments}}
        <section class="comments-section">
          <h3>Discussion</h3>
          {{#if (gt @model.comments.length 0)}}
            <div class="comments-container">
              <@fields.comments @format="embedded" />
            </div>
          {{else}}
            <p class="no-comments">No comments yet. Be the first to share your thoughts!</p>
          {{/if}}
        </section>
      {{/if}}
    </article>
    
    <style scoped> /* ³⁴ Component styles */
      .blog-post-surface {
        width: 100%;
        max-width: 42rem;
        margin: 0 auto;
        padding: clamp(1.25rem, 4vw, 2rem);
        display: flex;
        flex-direction: column;
        gap: clamp(1rem, 2.5vw, 1.5rem);
        height: 100%;
        min-height: 100%;
        overflow-y: auto;
        font-size: 0.875rem;
        line-height: 1.3;
      }
      
      @media (max-width: 800px) {
        .blog-post-surface {
          max-width: none;
          padding: clamp(1rem, 6vw, 1.5rem);
        }
      }
      
      .blog-post-surface > header h1 {
        font-size: clamp(1.125rem, 3vw, 1.5rem);
        margin-top: 0.25rem;
        line-height: 1.2;
      }
      
      .post-content {
        font-size: 0.8125rem;
        line-height: 1.25;
      }
      
      /* ³⁵ CRITICAL: Always style buttons completely - never use unstyled */
      .comment-button {
        /* Style Boxel components to match your design */
        gap: var(--boxel-sp-2xs);
      }
      
      .comment-button .button-icon {
        width: 1rem;
        height: 1rem;
      }
      
      /* ³⁶ CRITICAL: Spacing for containsMany collections */
      .tags-container > .containsMany-field {
        display: flex;
        flex-wrap: wrap;
        gap: 0.25rem; /* Essential spacing between tags */
      }
      
      .comments-container > .containsMany-field {
        display: flex;
        flex-direction: column;
        gap: 0.75rem; /* Essential spacing between comments */
      }
    </style>
  </template>
};
```

### WARNING: Do NOT Use Constructors for Default Values

**CRITICAL:** Constructors should NOT be used for setting default values in Boxel cards. Use template fallbacks (if field is editable) or computeVia (only if field is strictly read-only) instead.

```gts
// ❌ WRONG - Never use constructors for defaults
export class Todo extends CardDef {
  constructor(owner: unknown, args: {}) {
    super(owner, args);
    this.createdDate = new Date(); // DON'T DO THIS
    this.isCompleted = false;      // DON'T DO THIS
  }
}
```

### **CRITICAL: NEVER Create JavaScript Objects in Templates**

**Templates are for simple display logic only.** Never call constructors, create objects, or perform complex operations in template expressions.

```hbs
<!-- ❌ WRONG: Creating objects in templates -->
<span>{{if @model.currentMonth @model.currentMonth (formatDateTime (new Date()) "MMMM YYYY")}}</span>
<div>{{someFunction(@model.data)}}</div>

<!-- ✅ CORRECT: Move logic to JavaScript computed properties -->
<span>{{if @model.currentMonth @model.currentMonth this.currentMonthDisplay}}</span>
<div>{{this.processedData}}</div>
```

```gts
// ✅ CORRECT: Define logic in JavaScript
export class MyCard extends CardDef {
  get currentMonthDisplay() {
    return new Intl.DateTimeFormat('en-US', { 
      month: 'long', 
      year: 'numeric' 
    }).format(new Date());
  }
  
  get processedData() {
    return this.args.model?.data ? this.processData(this.args.model.data) : 'No data';
  }
  
  private processData(data: any) {
    // Complex processing logic here
    return result;
  }
}
```