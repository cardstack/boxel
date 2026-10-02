// Pretui — demo-reading-format: the option lists the format usage pages share.

export const SPOKEN_MODES = ['auto', 'always', 'off'];
export const NUMBER_STYLES = ['decimal', 'currency', 'percent', 'unit'];
// Typed as the union rather than string[] so the notation matrix can be
// iterated straight into @notation. Assignable to string[] for @options.
export const NOTATIONS: Array<'standard' | 'compact' | 'scientific' | 'engineering'> =
  ['standard', 'compact', 'scientific', 'engineering'];
export const LOCALES = ['en-US', 'de-DE', 'fr-FR', 'hi-IN', 'ja-JP', 'ar-EG'];

