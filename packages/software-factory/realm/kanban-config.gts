import StringField from 'https://cardstack.com/base/string';
import enumField from 'https://cardstack.com/base/enum';

import { IssueOptionField } from './issue-option';

export interface Option {
  value: string;
  label: string;
  color?: string;
}

export interface Column {
  key: string;
  label: string;
  fieldName: string;
  orderField: string;
  options: Option[];
}

export const issueStatusOptions: Option[] = [
  { value: 'backlog', label: 'Backlog', color: '#2b4fff' },
  {
    value: 'in_progress',
    label: 'In Progress',
    color: '#f9cd4a',
  },
  { value: 'blocked', label: 'Blocked', color: '#db1731' },
  { value: 'review', label: 'In Review', color: '#285028' },
  { value: 'done', label: 'Done', color: '#7a2cf4' },
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
  { value: 'planning', label: 'Planning', color: '#2b4fff' },
  { value: 'active', label: 'Active', color: '#285028' },
  { value: 'on_hold', label: 'On Hold', color: '#f59f0b' },
  { value: 'completed', label: 'Completed', color: '#7a2cf4' },
  { value: 'archived', label: 'Archived', color: '#9d9c9d' },
];

export const defaultColumns: Column[] = [
  {
    key: 'status',
    label: 'Status',
    fieldName: 'status',
    orderField: 'statusBoardOrder',
    options: issueStatusOptions,
  },
  {
    key: 'priority',
    label: 'Priority',
    fieldName: 'priority',
    orderField: 'priorityBoardOrder',
    options: issuePriorityOptions,
  },
  {
    key: 'issueType',
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

type IssueStatusOptionSource = {
  issueStatusOptions?: Array<{
    value?: string | null;
    label?: string | null;
    color?: string | null;
  }>;
};

type IssueStatusOwner = { project?: IssueStatusOptionSource | null };

function hasProject(
  owner: IssueStatusOwner | IssueStatusOptionSource,
): owner is IssueStatusOwner {
  return 'project' in owner;
}

export function configuredIssueStatusOptions(
  owner: IssueStatusOwner | IssueStatusOptionSource | null | undefined,
): Option[] {
  let statusOptions = owner
    ? hasProject(owner)
      ? owner.project?.issueStatusOptions
      : owner.issueStatusOptions
    : undefined;

  let configured = (statusOptions ?? [])
    .map(
      (option): Option => ({
        value: option.value ?? '',
        label: option.label ?? '',
        color: option.color ?? undefined,
      }),
    )
    .filter((option) => option.value && option.label);

  return configured.length ? configured : issueStatusOptions;
}

export const IssueStatusField = enumField(StringField, {
  options: function (this: {
    project?: { issueStatusOptions?: IssueOptionField[] } | null;
  }) {
    return configuredIssueStatusOptions(this);
  },
});

export const IssueTypeField = enumField(StringField, {
  options: issueTypeOptions,
});

export const IssuePriorityField = enumField(StringField, {
  options: issuePriorityOptions,
});

export const ProjectStatusField = enumField(StringField, {
  options: projectStatusOptions,
});

export const GroupByField = enumField(StringField, {
  options: defaultColumns.map(({ key, label }) => ({ key, label, value: key })),
});
