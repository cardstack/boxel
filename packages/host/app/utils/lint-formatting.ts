import type { LintResult } from '@cardstack/runtime-common';

export function formatLintIssue(
  message: LintResult['messages'][number],
): string {
  if (!message || typeof message.message !== 'string') {
    return '';
  }
  let trimmedMessage = message.message.trim();
  if (!trimmedMessage) {
    return '';
  }

  let location = '';
  if (typeof message.line === 'number') {
    if (typeof message.column === 'number') {
      location = `line ${message.line}:${message.column}`;
    } else {
      location = `line ${message.line}`;
    }
  }

  let ruleId = message.ruleId ? ` (${message.ruleId})` : '';
  if (location) {
    return `${location} ${trimmedMessage}${ruleId}`.trim();
  }
  return `${trimmedMessage}${ruleId}`.trim();
}

export function formatLintIssues(
  messages: LintResult['messages'] | undefined,
): string[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.map((message) => formatLintIssue(message)).filter(Boolean);
}

export function formatLintIssuesBySeverity(
  messages: LintResult['messages'] | undefined,
): { errors: string[]; warnings: string[] } {
  if (!Array.isArray(messages)) {
    return { errors: [], warnings: [] };
  }
  let errors: string[] = [];
  let warnings: string[] = [];
  for (let message of messages) {
    let formatted = formatLintIssue(message);
    if (!formatted) continue;
    if (message.severity === 2) {
      errors.push(formatted);
    } else {
      warnings.push(formatted);
    }
  }
  return { errors, warnings };
}
