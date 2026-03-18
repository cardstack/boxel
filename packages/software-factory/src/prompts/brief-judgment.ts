export interface FactoryBriefJudgmentPromptInput {
  title: string;
  sourceUrl: string;
  contentSummary: string;
  content: string;
  tags: string[];
}

const briefJudgmentInstructions = [
  'Review this factory brief and decide how narrowly the first implementation pass should be scoped.',
  '',
  'Instructions:',
  '- Decide whether to default to a thin MVP for the first implementation pass or keep a broader first pass.',
  '- If the brief is underspecified, create one or more follow-up clarification tickets that name the missing decisions.',
  '- If the brief should proceed but still needs a human checkpoint, create a review ticket and call out the specific areas that deserve attention.',
  '- Return the judgment in a way the factory can act on during planning and ticket bootstrap.',
] as const;

export function renderFactoryBriefJudgmentPrompt(
  input: FactoryBriefJudgmentPromptInput,
): string {
  let promptSections = [
    briefJudgmentInstructions[0],
    '',
    `Title: ${input.title}`,
    `Source URL: ${input.sourceUrl}`,
    `Summary: ${input.contentSummary}`,
    `Tags: ${input.tags.length > 0 ? input.tags.join(', ') : '(none)'}`,
    '',
    'Body:',
    input.content === '' ? '(no body content provided)' : input.content,
    '',
    ...briefJudgmentInstructions.slice(2),
  ];

  return promptSections.join('\n');
}
