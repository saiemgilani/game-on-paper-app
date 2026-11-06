// The Pro magic link no longer signs in on GET: opening /pro/auth?t=<token> shows a Sign in
// button, and only its POST spends the token, so an email scanner's prefetch leaves the link
// working. The evidence build forces every 'preview' flag on, 'pro' included. A made-up token
// is enough to show the flow: the page renders the button for it, and the POST lands on the
// sign-in form's "that link did not work" state.
const LINK = '/pro/auth?t=' + 'ab'.repeat(32);

export default async (page, base) => {
  await page.goto(base + LINK, { waitUntil: 'networkidle', timeout: 60_000 });
  const form = page.locator('#pro-auth-form');
  await form.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(1500);
  await Promise.all([page.waitForURL(/\/pro\/login\?err=1$/, { timeout: 15_000 }), form.locator('button[type="submit"]').click()]);
  if (!(await page.locator('#pro-login-form .text-danger').isVisible())) throw new Error('expected the invalid-link message on /pro/login');
  await page.waitForTimeout(1500);
};
