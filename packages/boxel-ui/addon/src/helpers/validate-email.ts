// Lightweight email validation for client-side feedback only
export default function validateEmail(input: string) {
  if (typeof input !== 'string') {
    return false;
  }

  const value = input.trim();
  if (value === '') {
    return false;
  }

  const firstAt = value.indexOf('@');
  if (firstAt === -1 || firstAt !== value.lastIndexOf('@')) {
    return false;
  }

  const localPart = value.slice(0, firstAt);
  const domainPart = value.slice(firstAt + 1);

  if (!localPart || !domainPart) {
    return false;
  }

  // Disallow characters that are not valid in the local part.
  if (localPart.includes('\r') || localPart.includes('\n')) {
    return false;
  }
  // eslint-disable-next-line no-useless-escape -- character class needs escaped '[' and '\\'
  if (/[\s"(),:;<>@\[\]\\]/u.test(localPart)) {
    return false;
  }
  if (
    localPart.startsWith('.') ||
    localPart.endsWith('.') ||
    localPart.includes('..')
  ) {
    return false;
  }

  // Basic domain validation allows internationalized labels.
  if (/[@\s]/u.test(domainPart)) {
    return false;
  }

  const domainLabels = domainPart.split('.');
  if (domainLabels.length < 2) {
    return false;
  }

  for (const label of domainLabels) {
    if (label.length === 0) {
      return false;
    }
    if (label.startsWith('-') || label.endsWith('-')) {
      return false;
    }
    if (label.includes('\r') || label.includes('\n') || /\s/u.test(label)) {
      return false;
    }
  }

  return true;
}
