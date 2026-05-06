**Always use optional chaining:**
```js
// ❌ UNSAFE
if (this.args.model.items.includes(x)) { }

// ✅ SAFE
if (this.args.model?.items?.includes?.(x)) { }
```

**Provide defaults:**
```js
return (this.args.model?.progress ?? 0) + 10;
```

**Wrap cross-card access in try-catch:**
```js
get authorName() {
  try {
    const author = this.args?.model?.author;
    return author?.name ?? 'Unknown Author';
  } catch (e) {
    console.error('Error accessing author', e);
    return 'Author Unavailable';
  }
}
```

## Defensive Programming in Boxel Components

**CRITICAL:** Prevent runtime errors by safely handling undefined/null values and malformed data. Cards boot with no data by default - every component must handle completely empty state gracefully.

### Essential Defensive Patterns

#### Always Use Optional Chaining (`?.`)
```js
// ❌ UNSAFE: Will throw if model is undefined
if (this.args.model.completedDays.includes(day)) { ... }

// ✅ SAFE: Optional chaining prevents errors
if (this.args.model?.completedDays?.includes?.(day)) { ... }
```

#### Provide Default Values (`??`)
```js
// ❌ UNSAFE: May result in NaN
return this.args.model.progress + 10;

// ✅ SAFE: Default value prevents NaN
return (this.args.model?.progress ?? 0) + 10;
```

#### Try-Catch for Network of Cards
When accessing data across card relationships, always wrap in try-catch to handle missing or malformed data:

```js
// ³⁷ In computed properties or methods
get authorDisplayName() {
  try {
    const author = this.args?.model?.author;
    if (!author) {
      console.warn('BlogPost: No author assigned');
      return 'Unknown Author';
    }
    
    const name = author.name || author.title;
    if (!name) {
      console.warn('BlogPost: Author exists but has no name', { authorId: author.id });
      return 'Unnamed Author';
    }
    
    return name;
  } catch (error) {
    console.error('BlogPost: Error accessing author data', {
      error,
      postId: this.args.model?.id,
      authorData: this.args.model?.author
    });
    return 'Author Unavailable';
  }
}

// ³⁸ In template getters
get relatedPostsSummary() {
  try {
    const posts = this.args.model?.relatedPosts;
    if (!Array.isArray(posts)) {
      return 'No related posts';
    }
    
    return posts
      .filter(post => post?.title) // Skip malformed entries
      .map(post => post.title)
      .join(', ') || 'No related posts';
      
  } catch (error) {
    console.error('BlogPost: Failed to process related posts', error);
    return 'Related posts unavailable';
  }
}
```

#### Validate Arrays Before Operations
```js
// ❌ UNSAFE: May throw if not an array
const sorted = this.completedDays.sort((a, b) => a - b);

// ✅ SAFE: Check existence and type first
if (!Array.isArray(this.completedDays) || !this.completedDays.length) {
  return [];
}
const sorted = [...this.completedDays].sort((a, b) => a - b);
```

**Key Principles:** 
- Assume data might be missing, null, or the wrong type
- Provide meaningful fallbacks for user display
- Log errors with context for debugging (include IDs, data state)
- Never let malformed data crash your UI