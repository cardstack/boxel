/**
 * Builds a pretty multi-line representation of system & user prompts so the
 * caller can decide how/when to log (and at what namespace / level).
 */
export interface PrettifyPromptOptions {
  scope: string; // e.g. "SearchAndChoose:ListingCategory"
  systemPrompt: string;
  userPrompt: string;
}

export function prettifyPrompts(opts: PrettifyPromptOptions): string {
  let header = `[${opts.scope}] Prompts`;
  let parts: string[] = [];
  parts.push(`=== ${header} ===`);
  parts.push('-- System Prompt --');
  parts.push(opts.systemPrompt.trimEnd());
  parts.push('-- User Prompt --');
  parts.push(opts.userPrompt.trimEnd());
  parts.push(`=== END ${header} ===`);
  return parts.join('\n\n');
}
