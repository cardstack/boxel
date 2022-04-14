import type * as monaco from 'monaco-editor';

export const gjsRegistryInfo: monaco.languages.ILanguageExtensionPoint = {
  id: 'glimmerJS',
  extensions: ['.gjs', '.gts'],
};

export const gjsDefinition: monaco.languages.IMonarchLanguage = {
  tokenPostfix: '.gjs',
  tokenizer: {
    root: [
      [
        /import|export|function|const|let|var/,
        { token: 'keyword', next: '@js', nextEmbedded: 'javascript' },
      ],
      [/\/\/.*/, { token: 'comment' }],
      [
        /<template\s*>/,
        {
          token: 'tag',
          bracket: '@open',
          next: '@hbs',
          nextEmbedded: 'handlebars',
        },
      ],
      [
        /<\/template\s*>/,
        {
          token: 'tag',
          bracket: '@close',
          next: '@js',
          nextEmbedded: 'javascript',
        },
      ],
    ],
    hbs: [
      [
        /<\/template\s*>/,
        { token: '@rematch', next: '@pop', nextEmbedded: '@pop' },
      ],
    ],
    js: [
      [
        /<template\s*>/,
        { token: '@rematch', next: '@pop', nextEmbedded: '@pop' },
      ],
    ],
  },
};
