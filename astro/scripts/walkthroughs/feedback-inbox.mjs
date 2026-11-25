// 'feedback-inbox': open the admin Feedback sheet, fill it in, attach an image and send it, then check the
// toast. The endpoint is intercepted, so nothing reaches Discord. Admin-only, so this records only with an
// admin session: the pr-evidence build has a random ADMIN_PASS, and the flow is run locally against a
// production `astro build` + `npm run preview` whose .dev.vars sets ADMIN_PASS:
//   WALKTHROUGH_COOKIE="gop_admin=$(node scripts/mint-admin-cookie.mjs "$ADMIN_PASS")" \
//     BASE=http://localhost:4321 npm run walkthrough -- --steps scripts/walkthroughs/feedback-inbox.mjs
export default async (page, base) => {
  let sent = null;
  await page.route('**/admin/api/feedback*', async (route) => {
    sent = route.request().postDataBuffer();
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
  });
  // ?view=preview: the admin's per-request override turns the preview flag on without a preview cookie
  await page.goto(base + '/admin?view=preview', { waitUntil: 'load', timeout: 90_000 });
  const open = page.locator('#feedback-open');
  // the flow exists to exercise the sheet: no button (no admin session) is a failed recording, not a skip
  if ((await open.count()) < 1) throw new Error('no Feedback button: set WALKTHROUGH_COOKIE to an admin session');
  await open.click();
  await page.locator('#feedback-sheet[open]').waitFor({ timeout: 5000 });
  await page.waitForTimeout(800);
  await page.selectOption('#feedback-type', 'bug');
  await page.locator('#feedback-title').fill('Play table runs off the edge on a phone');
  await page.locator('#feedback-message').fill('The last column is cut off on the game page at 390px.');
  // a 1x1 PNG: the sheet re-encodes it to a JPEG before sending
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
  await page.setInputFiles('#feedback-image', { name: 'shot.png', mimeType: 'image/png', buffer: png });
  await page.waitForTimeout(1000);
  await page.locator('[data-feedback-submit]').click();
  await page.locator('#feedback-toast .toast:not([hidden])').waitFor({ timeout: 10_000 });
  if (!sent || !sent.includes('filename="screenshot.jpg"')) throw new Error('the report did not carry the re-encoded image');
  await page.waitForTimeout(2500);
};
