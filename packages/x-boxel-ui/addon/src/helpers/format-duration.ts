export default function formatDuration(
  duration: number | null | undefined,
  options: {
    fallback?: string;
    format?: 'humanize' | 'timer' | 'short' | 'long';
    locale?: string;
    unit?: 'seconds' | 'minutes' | 'hours' | 'days' | 'milliseconds';
  } = {},
): string {
  if (duration == null || typeof duration !== 'number' || isNaN(duration)) {
    return options.fallback || '';
  }

  const {
    unit = 'seconds',
    format = 'humanize',
    locale = 'en-US',
    fallback,
  } = options;

  // Validate format and unit options
  const validFormats = ['humanize', 'timer', 'short', 'long'];
  const validUnits = ['seconds', 'minutes', 'hours', 'days', 'milliseconds'];

  if (typeof format !== 'string' || !validFormats.includes(format)) {
    return fallback || '';
  }

  if (typeof unit !== 'string' || !validUnits.includes(unit)) {
    return fallback || '';
  }

  // Convert to seconds
  let seconds = duration;
  switch (unit) {
    case 'milliseconds':
      seconds = duration / 1000;
      break;
    case 'minutes':
      seconds = duration * 60;
      break;
    case 'hours':
      seconds = duration * 3600;
      break;
    case 'days':
      seconds = duration * 86400;
      break;
  }

  const totalSeconds = Math.floor(seconds);
  const years = Math.floor(totalSeconds / (365 * 24 * 3600));
  const days = Math.floor((totalSeconds % (365 * 24 * 3600)) / (24 * 3600));
  const hours = Math.floor((totalSeconds % (24 * 3600)) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  // Helper function to get localized unit names using browser APIs
  const getUnitName = (unit: string, count: number): string => {
    try {
      // Use Intl.NumberFormat with unit style for proper pluralization and localization
      const nf = new Intl.NumberFormat(locale, {
        style: 'unit',
        unit: unit,
        unitDisplay: 'long', // Use full words like "years" instead of "yr"
      });

      // Format with a simple number (1 or 2) to get just the unit name without number formatting issues
      const testNumber = count === 1 ? 1 : 2;
      const formatted = nf.format(testNumber);
      // Remove the test number and any leading/trailing whitespace to get just the unit
      const unitOnly = formatted.replace(/^[0-9,.\s]+/, '').trim();

      return unitOnly || unit;
    } catch {
      // Final fallback using simple pluralization
      const isPlural = count !== 1;
      const englishNames: Record<string, [string, string]> = {
        year: ['year', 'years'],
        day: ['day', 'days'],
        hour: ['hour', 'hours'],
        minute: ['minute', 'minutes'],
        second: ['second', 'seconds'],
      };

      return englishNames[unit]?.[isPlural ? 1 : 0] || unit;
    }
  };

  switch (format) {
    case 'timer':
      if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
      }
      return `${minutes}:${secs.toString().padStart(2, '0')}`;

    case 'short':
      if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
      }
      if (minutes > 0) {
        return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
      }
      return `${secs}s`;

    case 'long': {
      const parts: string[] = [];

      if (years > 0) {
        parts.push(`${years} ${getUnitName('year', years)}`);
      }
      if (days > 0) {
        parts.push(`${days} ${getUnitName('day', days)}`);
      }
      if (hours > 0) {
        parts.push(`${hours} ${getUnitName('hour', hours)}`);
      }
      if (minutes > 0) {
        parts.push(`${minutes} ${getUnitName('minute', minutes)}`);
      }
      if (secs > 0 || parts.length === 0) {
        parts.push(`${secs} ${getUnitName('second', secs)}`);
      }

      return parts.join(', ');
    }

    case 'humanize':
    default:
      if (years > 0) {
        return `${years} ${getUnitName('year', years)}`;
      }
      if (days > 0) {
        return `${days} ${getUnitName('day', days)}`;
      }
      if (hours > 0) {
        return `${hours} ${getUnitName('hour', hours)}`;
      }
      if (minutes > 0) {
        return `${minutes} ${getUnitName('minute', minutes)}`;
      }
      return `${secs} ${getUnitName('second', secs)}`;
  }
}
