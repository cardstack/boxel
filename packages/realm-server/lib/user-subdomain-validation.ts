const RESERVED_SUBDOMAINS = [
  // Common service names
  'www',
  'api',
  'admin',
  'support',
  'help',
  'docs',
  'blog',
  'mail',
  'email',
  'ftp',
  'smtp',
  'pop',
  'imap',
  'news',
  'nntp',
  'irc',
  'chat',

  // Development/testing
  'test',
  'testing',
  'dev',
  'development',
  'staging',
  'demo',
  'sandbox',

  // Infrastructure
  'cdn',
  'assets',
  'static',
  'media',
  'files',
  'uploads',
  'downloads',
  'backup',
  'backups',
  'logs',
  'monitoring',
  'metrics',
  'health',

  // Security/admin
  'security',
  'auth',
  'login',
  'signin',
  'signup',
  'register',
  'account',
  'dashboard',
  'panel',
  'console',
  'control',
  'manage',
  'management',

  // Business functions
  'billing',
  'payments',
  'orders',
  'shop',
  'store',
  'sales',
  'marketing',
  'analytics',
  'stats',
  'reports',
  'audit',
  'compliance',

  // Common app names
  'app',
  'mobile',
  'desktop',
  'web',
  'client',
  'server',
  'service',
  'gateway',
  'proxy',
  'cache',
  'redis',
  'db',
  'database',
];

// Patterns that should be blocked
const RESERVED_PATTERNS = [
  /^[a-z]+-\d+$/, // service-123
  /^[a-z]+-v\d+$/, // api-v2, service-v1
  /^v\d+$/, // v1, v2, v3
  /^\d+$/, // pure numbers
  /^[a-z]+-api$/, // anything-api
  /^[a-z]+-admin$/, // anything-admin
  /^[a-z]+-test$/, // anything-test
];

export type SubdomainValidationResult = {
  valid: boolean;
  error?: string;
};

export function validateSubdomain(
  subdomain: string,
): SubdomainValidationResult {
  if (!subdomain || subdomain.trim().length === 0) {
    return { valid: false, error: 'Subdomain is required' };
  }

  // Check for punycode domains (homoglyph attack protection)
  if (subdomain.startsWith('xn--')) {
    return {
      valid: false,
      error: 'Punycode domains are not allowed for security reasons',
    };
  }

  const validSubdomainRegex = /^[a-z0-9-]+$/;
  if (!validSubdomainRegex.test(subdomain)) {
    return {
      valid: false,
      error:
        'Subdomain can only contain lowercase letters, numbers, and hyphens',
    };
  }

  if (subdomain.startsWith('-') || subdomain.endsWith('-')) {
    return {
      valid: false,
      error: 'Subdomain cannot start or end with a hyphen',
    };
  }

  if (subdomain.length < 2) {
    return {
      valid: false,
      error: 'Subdomain must be at least 2 characters long',
    };
  }
  if (subdomain.length > 63) {
    return {
      valid: false,
      error: 'Subdomain cannot be longer than 63 characters',
    };
  }

  if (RESERVED_SUBDOMAINS.includes(subdomain.toLowerCase())) {
    return {
      valid: false,
      error: 'This subdomain is reserved and cannot be used',
    };
  }

  if (
    RESERVED_PATTERNS.some((pattern) => pattern.test(subdomain.toLowerCase()))
  ) {
    return {
      valid: false,
      error: 'This subdomain follows a reserved pattern and cannot be used',
    };
  }

  return { valid: true };
}
