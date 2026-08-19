# Ember.js Best Practices

A structured repository for creating and maintaining Ember.js Best Practices optimized for agents and LLMs.

## Structure

- `rules/` - Individual rule files (one per rule), named `area-description.md`
- __`SKILL.md`__ - Skill definition for Claude Code, with the categorized rule index

## Rule Categories

Rules are organized by prefix:
- `route-` for Route Loading and Data Fetching (Section 1)
- `bundle-` for Build and Bundle Optimization (Section 2)
- `component-` and `exports-` for Component and Reactivity (Section 3)
- `a11y-` for Accessibility Best Practices (Section 4)
- `service-` for Service and State Management (Section 5)
- `template-` and `helper-` for Template Optimization (Section 6)
- `performance-` for Performance Optimization (Section 7)
- `testing-` for Testing Best Practices (Section 8)
- `vscode-` for Tooling and Configuration (Section 9)
- `advanced-` for Advanced Patterns (Section 10)

## Rule File Structure

Each rule file should follow this structure:

```markdown
---
title: Rule Title Here
impact: MEDIUM
impactDescription: Optional description
tags: tag1, tag2, tag3
---

## Rule Title Here

Brief explanation of the rule and why it matters.

**Incorrect (description of what's wrong):**

```javascript
// Bad code example
```

**Correct (description of what's right):**

```javascript
// Good code example
```

Optional explanatory text after examples.

Reference: [Link](https://example.com)
```

## File Naming Convention

- Rule files: `area-description.md` (e.g., `route-parallel-model.md`)
- Section is inferred from the filename prefix

## Impact Levels

- `CRITICAL` - Highest priority, major performance gains
- `HIGH` - Significant performance improvements
- `MEDIUM-HIGH` - Moderate-high gains
- `MEDIUM` - Moderate performance improvements
- `LOW-MEDIUM` - Low-medium gains
- `LOW` - Incremental improvements

## Contributing

When adding or modifying rules:

1. Use the correct filename prefix for your section
2. Follow the rule file structure above
3. Include clear bad/good examples with explanations
4. Add appropriate tags
5. Add the rule to SKILL.md's index under its category

## Accessibility Focus

This guide emphasizes Ember's strong accessibility ecosystem:

- **ember-a11y-testing** - Automated testing with axe-core
- **ember-a11y** - Route announcements and focus management
- **ember-focus-trap** - Modal focus trapping
- **ember-page-title** - Accessible page titles
- **Semantic HTML** - Proper use of native elements
- **ARIA attributes** - When custom elements are needed
- **Keyboard navigation** - Full keyboard support patterns

## Acknowledgments

Built for the Ember.js community, drawing from official guides, Octane patterns, and accessibility best practices.
