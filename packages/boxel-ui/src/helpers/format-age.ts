export default function formatAge(
  birthdate: Date | string | null | undefined,
  options: {
    fallback?: string;
    locale?: string;
    precise?: boolean;
    unit?: 'auto' | 'years' | 'months' | 'days';
  } = {},
): string {
  // Stub implementation - will be replaced with actual logic
  if (birthdate == null) {
    return options.fallback || '';
  }

  let date: Date;
  if (typeof birthdate === 'string') {
    date = new Date(birthdate);
  } else if (birthdate instanceof Date) {
    date = birthdate;
  } else {
    return options.fallback || '';
  }

  if (isNaN(date.getTime())) {
    return options.fallback || '';
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  if (diffMs < 0) {
    return options.fallback || '';
  }

  const { unit = 'auto', precise = false, locale = 'en-US' } = options;

  // Helper function to format time units with internationalization
  const formatTimeUnit = (value: number, unit: 'year' | 'month' | 'day') => {
    // Use Intl.NumberFormat with unit style for proper pluralization and localization
    // This gives us just the number and unit without "ago" or directional context
    const nf = new Intl.NumberFormat(locale, {
      style: 'unit',
      unit: unit,
      unitDisplay: 'long', // Use full words like "years" instead of "yr"
    });

    return nf.format(value).replace('年', '岁'); // the latter is more appropriate for age in Chinese
  };

  const years = Math.floor(diffMs / (365.25 * 24 * 60 * 60 * 1000));
  const months = Math.floor(diffMs / (30.44 * 24 * 60 * 60 * 1000));
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));

  if (unit === 'years' || (unit === 'auto' && years > 0)) {
    if (precise && years > 0) {
      const remainingMonths = Math.floor(
        (diffMs - years * 365.25 * 24 * 60 * 60 * 1000) /
          (30.44 * 24 * 60 * 60 * 1000),
      );
      return remainingMonths > 0
        ? `${formatTimeUnit(years, 'year')}, ${formatTimeUnit(remainingMonths, 'month')}`
        : formatTimeUnit(years, 'year');
    }
    return formatTimeUnit(years, 'year');
  }

  if (unit === 'months' || (unit === 'auto' && months > 0 && years === 0)) {
    return formatTimeUnit(months, 'month');
  }

  return formatTimeUnit(days, 'day');
}
