import { get } from "lodash";

export function pick(
  path: string,
  action: (value: any) => void
): (value: Event) => void {
  return function (event: Event): void {
    let value = get(event as any, path);
    action(value);
  };
}
