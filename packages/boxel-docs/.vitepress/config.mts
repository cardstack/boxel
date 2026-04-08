import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Boxel Documentation',
  description:
    'Comprehensive documentation for the Boxel platform — a card-based runtime for building composable, AI-native applications.',
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#6366f1' }],
    [
      'meta',
      {
        property: 'og:title',
        content: 'Boxel Documentation',
      },
    ],
    [
      'meta',
      {
        property: 'og:description',
        content:
          'Build composable, AI-native applications with Boxel cards.',
      },
    ],
  ],

  ignoreDeadLinks: true,

  markdown: {
    lineNumbers: true,
    theme: {
      light: 'github-light',
      dark: 'one-dark-pro',
    },
  },

  vue: {
    template: {
      compilerOptions: {
        // Treat {{ }} in code blocks as literal text, not Vue expressions
        delimiters: ['${', '}'] as [string, string],
      },
    },
  },

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Boxel Docs',

    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Core Concepts', link: '/core-concepts/cards-and-fields' },
      { text: 'Architecture', link: '/architecture/system-overview' },
      { text: 'API Reference', link: '/api-reference/realm-server-api' },
      {
        text: 'Resources',
        items: [
          { text: 'Card Development', link: '/card-development/defining-cards' },
          { text: 'AI & Agents', link: '/ai-agents/overview' },
          { text: 'Developer Tools', link: '/developer-tools/cli' },
          { text: 'Tutorials', link: '/tutorials/building-a-crm' },
        ],
      },
      {
        text: 'GitHub',
        link: 'https://github.com/cardstack/boxel',
      },
    ],

    sidebar: {
      '/guide/': [
        {
          text: 'Getting Started',
          items: [
            { text: 'Introduction', link: '/guide/introduction' },
            { text: 'Quick Start', link: '/guide/quick-start' },
            { text: 'Installation & Setup', link: '/guide/installation' },
            { text: 'Your First Card', link: '/guide/first-card' },
            { text: 'Project Structure', link: '/guide/project-structure' },
          ],
        },
      ],
      '/core-concepts/': [
        {
          text: 'Core Concepts',
          items: [
            { text: 'Cards & Fields', link: '/core-concepts/cards-and-fields' },
            { text: 'Realms', link: '/core-concepts/realms' },
            { text: 'Card Inheritance', link: '/core-concepts/card-inheritance' },
            {
              text: 'Card Rendering & Formats',
              link: '/core-concepts/card-rendering',
            },
            {
              text: 'Serialization & JSON-API',
              link: '/core-concepts/serialization',
            },
            { text: 'Computed Fields', link: '/core-concepts/computed-fields' },
            { text: 'Queries & Search', link: '/core-concepts/queries-and-search' },
            { text: 'Indexing', link: '/core-concepts/indexing' },
          ],
        },
      ],
      '/architecture/': [
        {
          text: 'Architecture',
          items: [
            { text: 'System Overview', link: '/architecture/system-overview' },
            { text: 'Runtime Architecture', link: '/architecture/runtime' },
            { text: 'Card Lifecycle', link: '/architecture/card-lifecycle' },
            {
              text: 'Module Resolution',
              link: '/architecture/module-resolution',
            },
            { text: 'Data Flow', link: '/architecture/data-flow' },
            {
              text: 'Authentication & Permissions',
              link: '/architecture/auth-and-permissions',
            },
          ],
        },
      ],
      '/card-development/': [
        {
          text: 'Card Development',
          items: [
            { text: 'Defining Cards', link: '/card-development/defining-cards' },
            {
              text: 'Field Types Reference',
              link: '/card-development/field-types',
            },
            {
              text: 'Templates & Components',
              link: '/card-development/templates',
            },
            { text: 'Styling Cards', link: '/card-development/styling' },
            { text: 'Commands', link: '/card-development/commands' },
            { text: 'Skills', link: '/card-development/skills' },
          ],
        },
      ],
      '/api-reference/': [
        {
          text: 'API Reference',
          items: [
            {
              text: 'Realm Server API',
              link: '/api-reference/realm-server-api',
            },
            { text: 'Card API', link: '/api-reference/card-api' },
            { text: 'Query API', link: '/api-reference/query-api' },
            {
              text: 'Field Decorators',
              link: '/api-reference/field-decorators',
            },
            {
              text: 'Base Card Types',
              link: '/api-reference/base-card-types',
            },
          ],
        },
      ],
      '/ai-agents/': [
        {
          text: 'AI & Agents',
          items: [
            { text: 'Overview', link: '/ai-agents/overview' },
            { text: 'Skills System', link: '/ai-agents/skills-system' },
            { text: 'Matrix Integration', link: '/ai-agents/matrix-integration' },
            {
              text: 'Building AI-Powered Cards',
              link: '/ai-agents/building-ai-cards',
            },
          ],
        },
      ],
      '/developer-tools/': [
        {
          text: 'Developer Tools',
          items: [
            { text: 'Boxel CLI', link: '/developer-tools/cli' },
            {
              text: 'VS Code Extension',
              link: '/developer-tools/vscode-extension',
            },
            { text: 'ESLint Plugin', link: '/developer-tools/eslint-plugin' },
            { text: 'Testing', link: '/developer-tools/testing' },
          ],
        },
      ],
      '/tutorials/': [
        {
          text: 'Tutorials',
          items: [
            { text: 'Building a CRM', link: '/tutorials/building-a-crm' },
            { text: 'Building a Blog', link: '/tutorials/building-a-blog' },
            {
              text: 'Themes & Customization',
              link: '/tutorials/themes-and-customization',
            },
            { text: 'Patterns & Best Practices', link: '/tutorials/patterns' },
          ],
        },
      ],
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/cardstack/boxel' },
    ],

    search: {
      provider: 'local',
    },

    editLink: {
      pattern:
        'https://github.com/cardstack/boxel/edit/main/packages/boxel-docs/:path',
      text: 'Edit this page on GitHub',
    },

    footer: {
      message: 'Released under the MPL-2.0 License.',
      copyright: 'Copyright © 2024-present Cardstack',
    },
  },
});
