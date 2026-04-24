import StringField from 'https://cardstack.com/base/string';
import enumField from 'https://cardstack.com/base/enum';

import { IssueOptionField } from './issue-option';

import type { Issue, Project } from './darkfactory';

export interface Option {
  value: string;
  label: string;
  color?: string;
}

export interface Column {
  value: string;
  label: string;
  fieldName: string;
  orderField: string;
  options: Option[];
}

export const issueStatusOptions: Option[] = [
  { value: 'backlog', label: 'Backlog', color: 'var(--boxel-navy)' },
  {
    value: 'in_progress',
    label: 'In Progress',
    color: 'var(--boxel-warning-200)',
  },
  { value: 'blocked', label: 'Blocked', color: 'var(--boxel-red)' },
  { value: 'review', label: 'In Review', color: 'var(--boxel-dark-green)' },
  { value: 'done', label: 'Done', color: 'var(--boxel-purple)' },
];

export const issueTypeOptions: Option[] = [
  { value: 'bootstrap', label: 'Bootstrap' },
  { value: 'feature', label: 'Feature' },
  { value: 'bug', label: 'Bug' },
  { value: 'task', label: 'Task' },
  { value: 'research', label: 'Research' },
  { value: 'infrastructure', label: 'Infrastructure' },
];

export const issuePriorityOptions: Option[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

export const projectStatusOptions: Option[] = [
  { value: 'planning', label: 'Planning', color: 'var(--boxel-navy)' },
  { value: 'active', label: 'Active', color: 'var(--boxel-dark-green)' },
  { value: 'on_hold', label: 'On Hold', color: 'var(--boxel-orange)' },
  { value: 'completed', label: 'Completed', color: 'var(--boxel-purple)' },
  { value: 'archived', label: 'Archived', color: 'var(--boxel-500)' },
];

export const defaultColumns: Column[] = [
  {
    value: 'status',
    label: 'Status',
    fieldName: 'status',
    orderField: 'statusBoardOrder',
    options: issueStatusOptions,
  },
  {
    value: 'priority',
    label: 'Priority',
    fieldName: 'priority',
    orderField: 'priorityBoardOrder',
    options: issuePriorityOptions,
  },
  {
    value: 'issueType',
    label: 'Type',
    fieldName: 'issueType',
    orderField: 'issueTypeBoardOrder',
    options: issueTypeOptions,
  },
];

export function findOptionColor(
  options: Option[] | undefined,
  value: string | null | undefined,
): string | undefined {
  if (!value) return undefined;
  return options?.find((option) => option.value === value)?.color;
}

export function buildIssueOptionFields(options: Option[]): IssueOptionField[] {
  return options.map((option) => new IssueOptionField(option));
}

export const IssueStatusField = enumField(StringField, {
  options: function (this: Issue) {
    const opts = this.project?.issueStatusOptions;
    return opts?.length ? opts : issueStatusOptions;
  },
});

export const IssueTypeField = enumField(StringField, {
  options: function (this: Issue) {
    const opts = this.project?.issueTypeOptions;
    return opts?.length ? opts : issueTypeOptions;
  },
});

export const IssuePriorityField = enumField(StringField, {
  options: function (this: Issue) {
    const opts = this.project?.issuePriorityOptions;
    return opts?.length ? opts : issuePriorityOptions;
  },
});

export const ProjectStatusField = enumField(StringField, {
  options: projectStatusOptions,
});

export const GroupByField = enumField(StringField, {
  options: defaultColumns.map(({ value, label }) => ({ value, label })),
});
