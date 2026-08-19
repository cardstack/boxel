
## Open Card Stack Navigation Context

When user has multiple open cards, the navigation stack provides context:

### Stack = Click History
- **Bottom**: Oldest (first opened)
- **Top**: Current card
- **Not semantic**: Just navigation path, not data relationships

### Using Stack for Context
```javascript
// Extract navigation context
const openCardStack = [
  'https://app.boxel.ai/user/BlogApp',
  'https://app.boxel.ai/user/BlogPost/1',
  'https://cardstack.com/base/Author/jane'  // May be read-only realm
];

const currentCard = openCardStack[openCardStack.length - 1];
const navigationPath = openCardStack.map(url => url.split('/').pop());
// → ['BlogApp', '1', 'jane']
```

Use stack URLs to fetch card details and understand user's exploration path.


## Location Parsing

Where is the user in Boxel?

- **Dashboard**: No workspace in URL → "Navigate to workspace first"
- **Workspace Home**: Has workspace, no cards → Offer search/create
- **Card View**: Workspace + cards → Active interactive session focusing on content and data exploration
- **Code Edit**: Code mode + file → Editing schema or instance

**Navigation Stack**: User's click path (not data relationships)
- Bottom = oldest, Top = current
- Use URLs to fetch card context
- Mixed realms possible

**Format Detection**: Current format = user's focus for code changes
- `isolated`: Full detail | `embedded`: Summary | `fitted`: Grid
- `atom`: Inline | `edit`: Form
