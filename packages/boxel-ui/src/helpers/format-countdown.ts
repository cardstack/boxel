export default function formatCountdown(
  eventDate: Date | string | null | undefined,
  options: {
    fallback?: string;
    locale?: string;
    showDays?: boolean;
    showHours?: boolean;
    showMinutes?: boolean;
    showSeconds?: boolean;
  } = {},
): string {
  // Stub implementation - will be replaced with actual logic
  if (eventDate == null) {
    return options.fallback || '';
  }

  let date: Date;
  if (typeof eventDate === 'string') {
    date = new Date(eventDate);
  } else if (eventDate instanceof Date) {
    date = eventDate;
  } else {
    return options.fallback || '';
  }

  if (isNaN(date.getTime())) {
    return options.fallback || '';
  }

  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs < -1000) {
    // Only show "Expired" if more than 1 second in the past
    return options.fallback || 'Expired';
  }

  const {
    showDays = false,
    showHours = true,
    showMinutes = true,
    showSeconds = true,
    locale = 'en-US',
  } = options;

  // Add 500ms to account for execution time and round up to the nearest second
  const adjustedDiffMs = Math.max(0, diffMs + 500); // Ensure we don't go negative
  const totalSeconds = Math.floor(adjustedDiffMs / 1000);
  const days = Math.floor(totalSeconds / (24 * 60 * 60));
  const hours = Math.floor((totalSeconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((totalSeconds % (60 * 60)) / 60);
  const seconds = totalSeconds % 60;

  // Handle the case where we only want to show days
  if (showDays && !showHours && !showMinutes && !showSeconds) {
    const dayLabel = getDayLabel(days, locale);
    return `${days} ${dayLabel}`;
  }

  // If showing days, always use the days format
  if (showDays) {
    const dayLabel = getDayLabel(days, locale);
    const timeComponents = [];

    if (showHours) {
      timeComponents.push(hours.toString()); // No padding for hours when showing days
    }
    if (showMinutes) {
      timeComponents.push(minutes.toString().padStart(2, '0'));
    }
    if (showSeconds) {
      timeComponents.push(seconds.toString().padStart(2, '0'));
    }

    const timeString = timeComponents.join(':');
    return `${days} ${dayLabel}, ${timeString}`;
  }

  // For times without days or when days are hidden, show as H:MM:SS format
  const timeComponents = [];

  // Calculate total hours if days are hidden
  const totalHours = showDays ? hours : hours + days * 24;

  // Always include hours when not showing days or when explicitly showing hours
  if (showHours || !showDays) {
    // Don't pad hours with leading zero for basic format
    timeComponents.push(totalHours.toString());
  }

  if (showMinutes) {
    timeComponents.push(minutes.toString().padStart(2, '0'));
  }

  if (showSeconds) {
    timeComponents.push(seconds.toString().padStart(2, '0'));
  }

  return timeComponents.join(':') || '0:00:00';
}

function getDayLabel(days: number, locale: string): string {
  if (locale.startsWith('es')) {
    return days === 1 ? 'día' : 'días';
  } else if (locale.startsWith('fr')) {
    return days === 1 ? 'jour' : 'jours';
  } else {
    return days === 1 ? 'day' : 'days';
  }
}
