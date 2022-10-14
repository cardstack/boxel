export const SEPARATOR = '----';
export const GROUP_TYPES = {
  LARGE_MODAL_CARD: 'large-modal-card',
  SMALL_MODAL_CARD: 'small-modal-card',
  BREADCRUMB_BAR: 'breadcrumb-bar',
  OPTION_CARD: 'option-card',
} as const;

const ORDER = ['groupType', 'id', 'subType', 'state'] as const;
export function createRole(options: Record<typeof ORDER[number], string>) {
  return ORDER.map((k) => options[k]).join(SEPARATOR);
}

export function dataFromRole(role: string) {
  let split = role.split(SEPARATOR);
  return Object.fromEntries(
    ORDER.map((k, i) => [k, split[i] as string])
  ) as Record<typeof ORDER[number], string>;
}
