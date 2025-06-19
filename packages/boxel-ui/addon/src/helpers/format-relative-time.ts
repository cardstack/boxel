export default function formatRelativeTime(
  timestamp: Date | string | number | null | undefined,
  options: {
    fallback?: string;
    locale?: string;
    size?: 'tiny' | 'medium';
  } = {},
): string {
  if (timestamp == null) {
    return options.fallback || '';
  }

  let date: Date;
  if (typeof timestamp === 'string' || typeof timestamp === 'number') {
    date = new Date(timestamp);
  } else if (timestamp instanceof Date) {
    date = timestamp;
  } else {
    return options.fallback || '';
  }

  if (isNaN(date.getTime())) {
    return options.fallback || '';
  }

  const { size = 'medium', locale = 'en-US' } = options;
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const isFuture = diffMs < 0;
  const absDiffMs = Math.abs(diffMs);

  const seconds = Math.floor(absDiffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const weeks = Math.floor(days / 7);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  // Handle special cases for "now" and "just now"
  if (absDiffMs < 1000) {
    return 'now';
  }
  if (absDiffMs < 30000 && !isFuture) {
    // Less than 30 seconds ago
    return 'just now';
  }

  if (size === 'tiny') {
    // Tiny format is always in English abbreviations regardless of locale
    if (years > 0) {
      return `${years}y`;
    }
    if (months > 0) {
      return `${months}mo`;
    }
    if (weeks > 0) {
      return `${weeks}w`;
    }
    if (days > 0) {
      return `${days}d`;
    }
    if (hours > 0) {
      return `${hours}h`;
    }
    if (minutes > 0) {
      return `${minutes}m`;
    }
    return `${seconds}s`;
  }

  // Medium size uses Intl.RelativeTimeFormat for localization
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  // Determine the appropriate unit and value
  let value: number;
  let unit: Intl.RelativeTimeFormatUnit;

  if (years > 0) {
    value = years;
    unit = 'year';
  } else if (months > 0) {
    value = months;
    unit = 'month';
  } else if (weeks > 0) {
    value = weeks;
    unit = 'week';
  } else if (days > 0) {
    value = days;
    unit = 'day';
  } else if (hours > 0) {
    value = hours;
    unit = 'hour';
  } else if (minutes > 0) {
    value = minutes;
    unit = 'minute';
  } else {
    value = seconds;
    unit = 'second';
  }

  // Handle near-boundary times that should be rounded up with "about"
  let actualValue = isFuture ? value : -value;
  let actualUnit = unit;
  let shouldAddAbout = false;

  // Check if we're close to the next boundary and should round up
  // Only round up if we're not at an exact boundary
  const remainingMinutes = minutes % 60;
  const remainingHours = hours % 24;

  if (unit === 'hour' && remainingMinutes >= 50 && remainingMinutes < 60) {
    // Between 1h 50m and 1h 59m 59s, round up to next hour with "about"
    actualValue = isFuture ? value + 1 : -(value + 1);
    actualUnit = 'hour';
    shouldAddAbout = true;
  } else if (unit === 'day' && remainingHours >= 23 && remainingHours < 24) {
    // 23h+, use "yesterday" or "tomorrow"
    actualValue = isFuture ? 1 : -1;
    actualUnit = 'day';
    shouldAddAbout = false; // "yesterday" doesn't need "about"
  }

  let result = rtf.format(actualValue, actualUnit);

  // Add "about" prefix for rounded-up times
  if (shouldAddAbout) {
    result = result.replace(/^(\d+)/, 'about $1');
  }

  return result;
}
