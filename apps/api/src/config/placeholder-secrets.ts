/**
 * Placeholder values used by `.env.example` and development defaults.
 *
 * Production startup rejects every one of them (CFG-001), and the release
 * secret scan allowlists exactly these values (CFG-006). Keep the list in
 * lower case; matching is case-insensitive.
 */
export const PLACEHOLDER_SECRETS = [
  'change-me',
  'changeme',
  'cashlens_password',
  'replace-with-a-random-jwt-secret',
  'replace-with-at-least-32-random-characters',
  'replace-with-a-random-oauth-state-secret',
  'replace-with-google-oauth-client-id',
  'replace-with-google-oauth-client-secret',
  'replace-with-smtp-password',
  'replace-with-a-strong-database-password',
] as const;

const PLACEHOLDER_PREFIXES = ['replace-with-', 'change-me', 'changeme'];

export function isPlaceholderSecret(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return (
    (PLACEHOLDER_SECRETS as readonly string[]).includes(normalized) ||
    PLACEHOLDER_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    /^<[^<>]*>$/.test(normalized)
  );
}
