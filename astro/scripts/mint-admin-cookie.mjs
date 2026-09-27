// Print a `gop_admin` session cookie value for a given ADMIN_PASS, so a
// headless run (scripts/visual-check.mjs, the pr-evidence workflow) can shoot
// admin-only UI. The admin tools on the game page render for nobody without
// one, so a matrix shot without it is a shot of the feature being absent.
//
//   VISUAL_CHECK_COOKIES="gop_admin=$(node scripts/mint-admin-cookie.mjs "$ADMIN_PASS")" \
//     BASE=http://127.0.0.1:4321 npm run visual-check -- /game/401856682
//
// The construction is src/utils/adminSession.ts's, repeated here because that
// file is TypeScript and this runs under bare node. test/adminGameTools.test.ts
// asserts a value minted this way passes verifyAdminCookie, so the two cannot
// drift apart.
const secret = process.argv[2] ?? process.env.ADMIN_PASS;
if (!secret) {
    console.error('usage: node scripts/mint-admin-cookie.mjs <ADMIN_PASS>  (or set ADMIN_PASS)');
    process.exit(2);
}
const ttlS = Number(process.argv[3] ?? 12 * 60 * 60);
const expiry = Math.floor(Date.now() / 1000) + ttlS;
const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`gop-admin:${expiry}`));
process.stdout.write(`v1.${expiry}.${[...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')}`);
