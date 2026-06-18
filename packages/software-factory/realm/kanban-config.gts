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
    color: '#b8860b',
  },
  { value: 'blocked', label: 'Blocked', color: '#db1731' },
  { value: 'review', label: 'In Review', color: '#285028' },
  { value: 'done', label: 'Done', color: '#7a2cf4' },
];

export const issueTypeOptions: Option[] = [
  { value: 'bootstrap', label: 'Bootstrap' },
  { value: 'feature', label: 'Feature' },
  { value: 'adjustment', label: 'Adjustment' },
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

type IssueOptionArray = Array<{
  value?: string | null;
  label?: string | null;
  color?: string | null;
}>;

function hasProject<S extends object>(
  owner: S | { project?: S | null },
): owner is { project?: S | null } {
  return 'project' in owner;
}

function resolveOptions(
  optionArray: IssueOptionArray | null | undefined,
  defaults: Option[],
): Option[] {
  let configured = (optionArray ?? [])
    .map(
      (option): Option => ({
        value: option.value ?? '',
        label: option.label ?? '',
        color: option.color ?? undefined,
      }),
    )
    .filter((option) => option.value && option.label);
  return configured.length ? configured : defaults;
}

type IssueStatusOptionSource = { issueStatusOptions?: IssueOptionArray };
type IssueStatusOwner = { project?: IssueStatusOptionSource | null };

export function getIssueStatusOptions(
  owner: IssueStatusOwner | IssueStatusOptionSource | null | undefined,
): Option[] {
  let options = owner
    ? hasProject(owner)
      ? owner.project?.issueStatusOptions
      : owner.issueStatusOptions
    : undefined;
  return resolveOptions(options, issueStatusOptions);
}

type IssueTypeOptionSource = { issueTypeOptions?: IssueOptionArray };
type IssueTypeOwner = { project?: IssueTypeOptionSource | null };

export function getIssueTypeOptions(
  owner: IssueTypeOwner | IssueTypeOptionSource | null | undefined,
): Option[] {
  let options = owner
    ? hasProject(owner)
      ? owner.project?.issueTypeOptions
      : owner.issueTypeOptions
    : undefined;
  return resolveOptions(options, issueTypeOptions);
}

type IssuePriorityOptionSource = { issuePriorityOptions?: IssueOptionArray };
type IssuePriorityOwner = { project?: IssuePriorityOptionSource | null };

export function getIssuePriorityOptions(
  owner: IssuePriorityOwner | IssuePriorityOptionSource | null | undefined,
): Option[] {
  let options = owner
    ? hasProject(owner)
      ? owner.project?.issuePriorityOptions
      : owner.issuePriorityOptions
    : undefined;
  return resolveOptions(options, issuePriorityOptions);
}

export function getProjectStatusOptions(
  owner: { projectStatusOptions?: IssueOptionArray | null } | null | undefined,
): Option[] {
  return resolveOptions(owner?.projectStatusOptions, projectStatusOptions);
}

export const IssueStatusField = enumField(StringField, {
  options: function (this: {
    project?: { issueStatusOptions?: IssueOptionField[] } | null;
  }) {
    return getIssueStatusOptions(this);
  },
  defaultOptions: issueStatusOptions,
});

export const IssueTypeField = enumField(StringField, {
  options: function (this: {
    project?: { issueTypeOptions?: IssueOptionField[] } | null;
  }) {
    return getIssueTypeOptions(this);
  },
  defaultOptions: issueTypeOptions,
});

export const IssuePriorityField = enumField(StringField, {
  options: function (this: {
    project?: { issuePriorityOptions?: IssueOptionField[] } | null;
  }) {
    return getIssuePriorityOptions(this);
  },
  defaultOptions: issuePriorityOptions,
});

export const ProjectStatusField = enumField(StringField, {
  options: function (this: {
    projectStatusOptions?: IssueOptionField[] | null;
  }) {
    return getProjectStatusOptions(this);
  },
  defaultOptions: projectStatusOptions,
});

export const GroupByField = enumField(StringField, {
  options: defaultColumns.map(({ key, label }) => ({ key, label, value: key })),
});
