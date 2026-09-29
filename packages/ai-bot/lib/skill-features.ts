// Skill sections marked with a feature (see `applySkillFeatureFlags`) reach
// the model only when that feature is listed here, comma-separated, for
// example `AI_BOT_SKILL_FEATURES=catalog-search`. Unset means every marked
// section is left out.
export function enabledSkillFeatures(): string[] {
  return (process.env.AI_BOT_SKILL_FEATURES ?? '')
    .split(',')
    .map((feature) => feature.trim())
    .filter(Boolean);
}
