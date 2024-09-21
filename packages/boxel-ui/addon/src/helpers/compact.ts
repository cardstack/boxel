export default function compact<T>(value: T[]): NonNullable<T>[] {
  return value.filter((item) => Boolean(item)) as NonNullable<T>[];
}
