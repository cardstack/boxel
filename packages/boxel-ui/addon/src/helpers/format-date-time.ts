export default function formatDateTime(
  date: Date | string | number | null | undefined,
  options: {
    fallback?: string;
    format?: string;
    locale?: string;
    parse?: { serialOrigin?: 'excel1900' | 'excel1904' };
    relative?: boolean;
    size?: 'tiny' | 'short' | 'medium' | 'long';
  } = {},
): string {
  // Handle null/undefined cases
  if (date == null) {
    return options.fallback || '';
  }

  let parsedDate: Date;

  // Parse the date based on input type
  if (typeof date === 'number') {
    // Handle Excel serial dates
    if (options.parse?.serialOrigin) {
      const { serialOrigin } = options.parse;

      if (serialOrigin === 'excel1900') {
        // Excel 1900 system: January 1, 1900 is day 1
        // Excel has a bug where it treats 1900 as a leap year
        const excel1900Base = new Date(1900, 0, 1); // January 1, 1900
        parsedDate = new Date(
          excel1900Base.getTime() + (date - 2) * 24 * 60 * 60 * 1000,
        );
      } else if (serialOrigin === 'excel1904') {
        // Excel 1904 system: January 1, 1904 is day 0
        const excel1904Base = new Date(1904, 0, 1); // January 1, 1904
        parsedDate = new Date(
          excel1904Base.getTime() + date * 24 * 60 * 60 * 1000,
        );
      } else {
        parsedDate = new Date(date);
      }
    } else {
      parsedDate = new Date(date);
    }
  } else if (typeof date === 'string') {
    parsedDate = new Date(date);
  } else if (date instanceof Date) {
    parsedDate = date;
  } else {
    return options.fallback || 'Invalid date';
  }

  // Validate the parsed date
  if (isNaN(parsedDate.getTime())) {
    return options.fallback || 'Invalid date';
  }

  const { size = 'medium', relative, format, locale = 'en-US' } = options;

  // Handle relative time formatting
  if (relative) {
    const now = new Date();
    const diffMs = now.getTime() - parsedDate.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    if (diffHours >= 1) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    } else {
      return 'Just now';
    }
  }

  // Handle custom format strings
  if (format !== undefined) {
    try {
      if (!format || format === '') {
        return options.fallback || 'Empty format';
      }

      // Simple format string replacement - would normally use a proper date formatting library
      if (format === 'YYYY-MM-DD') {
        const year = parsedDate.getFullYear();
        const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
        const day = String(parsedDate.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      } else if (format === 'MMM D, YYYY') {
        const monthNames = [
          'Jan',
          'Feb',
          'Mar',
          'Apr',
          'May',
          'Jun',
          'Jul',
          'Aug',
          'Sep',
          'Oct',
          'Nov',
          'Dec',
        ];
        const month = monthNames[parsedDate.getMonth()];
        const day = parsedDate.getDate();
        const year = parsedDate.getFullYear();
        return `${month} ${day}, ${year}`;
      } else {
        // Invalid format
        return options.fallback || 'Format error';
      }
    } catch {
      return options.fallback || 'Format error';
    }
  }

  // Handle size-based formatting
  const now = new Date();
  const isToday = parsedDate.toDateString() === now.toDateString();

  try {
    switch (size) {
      case 'tiny':
        if (isToday) {
          return parsedDate.toLocaleTimeString(locale, {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          });
        } else {
          const month = parsedDate.getMonth() + 1;
          const day = parsedDate.getDate();
          return `${month}/${day}`;
        }

      case 'short':
        if (isToday) {
          return 'Today';
        } else {
          return parsedDate.toLocaleDateString(locale, {
            month: 'short',
            day: 'numeric',
          });
        }

      case 'medium':
        return parsedDate.toLocaleDateString(locale, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        });

      case 'long':
        return parsedDate.toLocaleDateString(locale, {
          weekday: 'long',
          month: 'long',
          day: 'numeric',
          year: 'numeric',
          timeZone: 'UTC',
        });

      default:
        return parsedDate.toLocaleDateString(locale);
    }
  } catch {
    return options.fallback || 'Invalid date';
  }
}
