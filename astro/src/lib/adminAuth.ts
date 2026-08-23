// Constant-time basic-auth check. Pure (no node:crypto) so it runs
// identically under vitest, node dev, and Cloudflare Workers.
export function checkBasicAuth(header: string | null, user?: string, pass?: string): boolean {
  if (!user || !pass) return false;
  const expected = 'Basic ' + btoa(`${user}:${pass}`);
  if (!header || header.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= header.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
