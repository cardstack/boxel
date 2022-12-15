import classnames from 'classnames';

export default function classNames(
  arg: string | undefined,
  hash: Record<string, string | boolean | number | undefined>
): string {
  const entries = Object.entries(hash);
  const obj = Object.fromEntries(entries);

  return classnames(arg, obj);
}
