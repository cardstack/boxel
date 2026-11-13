// Fixed prefixes vendors put on every key they issue. Every key of that vendor
// shares one, and text about the vendor quotes it, so a prefix identifies no
// one: what follows it is the secret. They are listed rather than recognized
// by shape, because a pattern can't tell a prefix from the start of a random
// tail that happens to contain a `-` or `_`. Longest first, so the first
// match is the most specific.
//
// A leaf module with no imports, so the realm server's response scrubber and
// the host's run-log redaction share it.
export const CREDENTIAL_PREFIXES: readonly string[] = [
  'sk-or-v1-', // OpenRouter
  'sk-ant-api03-', // Anthropic
  'sk-ant-',
  'sk-proj-', // OpenAI
  'sk-svcacct-',
  'sk-',
  'github_pat_', // GitHub
  'ghp_',
  'gho_',
  'ghu_',
  'ghs_',
  'ghr_',
  'glpat-', // GitLab
  'xoxb-', // Slack
  'xoxp-',
  'xapp-',
  'sk_live_', // Stripe
  'sk_test_',
  'rk_live_',
  'rk_test_',
  'AIza', // Google API keys
].sort((a, b) => b.length - a.length);
