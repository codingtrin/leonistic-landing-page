import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

// Live site under test. Override with SITE_URL; defaults to the Vercel deployment.
const SITE_URL = process.env.SITE_URL || 'https://leonistic.vercel.app';

const SCREENSHOT_DIR = 'tests/screenshots';
const REPORT_PATH = 'tests/qa-report.md';

// Text that would signal a broken page even if the HTTP status looked fine.
const ERROR_MARKERS = [
  '404',
  'not found',
  'this page could not be found',
  '500',
  'internal server error',
  'application error',
  'something went wrong',
];

type PageResult = {
  name: string;
  url: string;
  status: number | null;
  hasNav: boolean;
  hasFooter: boolean;
  screenshot: string;
};

// Treat "/" and "/index.html" as the same page for de-duplication.
function normPath(u: URL): string {
  const p = u.pathname.replace(/\/index\.html$/i, '/');
  return p === '' ? '/' : p;
}

function slugFor(u: URL): string {
  const p = normPath(u);
  if (p === '/') return 'home';
  return p.replace(/^\//, '').replace(/\.html$/i, '').replace(/\//g, '-') || 'home';
}

test('browser QA sweep of nav/footer pages + form validation', async ({ page }) => {
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  const siteOrigin = new URL(SITE_URL).origin;
  const results: PageResult[] = [];

  await test.step('Open the live site and screenshot the landing page', async () => {
    const resp = await page.goto(SITE_URL, { waitUntil: 'networkidle' });
    const shot = `${SCREENSHOT_DIR}/landing.png`;
    await page.screenshot({ path: shot, fullPage: true });
    results.push({
      name: (await page.title()) || 'Landing',
      url: SITE_URL,
      status: resp?.status() ?? null,
      hasNav: (await page.locator('nav').count()) > 0,
      hasFooter: (await page.locator('footer').count()) > 0,
      screenshot: shot,
    });
  });

  // Collect raw hrefs from the nav and footer, then keep only internal pages.
  const internal = await test.step('Find internal links in nav and footer', async () => {
    const hrefs = await page.locator('nav a, footer a').evaluateAll((els) =>
      els.map((el) => (el as HTMLAnchorElement).getAttribute('href') || '')
    );

    const seen = new Set<string>();
    const links: { raw: string; abs: string }[] = [];
    for (const raw of hrefs) {
      if (!raw) continue;
      // Skip in-page anchors, mailto:, tel:, etc.
      if (raw.startsWith('#') || raw.startsWith('mailto:') || raw.startsWith('tel:')) continue;

      let u: URL;
      try {
        u = new URL(raw, SITE_URL);
      } catch {
        continue;
      }
      if (u.origin !== siteOrigin) continue; // external link — skip

      const key = normPath(u);
      if (seen.has(key)) continue; // already queued this page
      seen.add(key);
      links.push({ raw, abs: u.href });
    }
    console.log(`Found ${links.length} internal page link(s): ${links.map((l) => l.raw).join(', ')}`);
    return links;
  });

  for (const link of internal) {
    const target = new URL(link.abs);
    const slug = slugFor(target);

    await test.step(`Visit "${link.raw}"`, async () => {
      // Always start from home so we are genuinely clicking the nav/footer link.
      await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });

      const respPromise = page
        .waitForResponse(
          (r) => r.frame() === page.mainFrame() && r.request().isNavigationRequest(),
          { timeout: 15000 }
        )
        .catch(() => null);

      await page.locator(`nav a[href="${link.raw}"], footer a[href="${link.raw}"]`).first().click();
      await page.waitForLoadState('networkidle');

      let resp = await respPromise;
      // Fallback: if the click capture missed, hit the URL directly for a status.
      let status = resp?.status() ?? null;
      if (status === null) {
        const direct = await page.request.get(link.abs).catch(() => null);
        status = direct?.status() ?? null;
      }

      const bodyText = (await page.locator('body').innerText()).toLowerCase();
      const hasErrorText = ERROR_MARKERS.some((m) => bodyText.includes(m));

      const shot = `${SCREENSHOT_DIR}/${slug}.png`;
      await page.screenshot({ path: shot, fullPage: true });

      results.push({
        name: (await page.title()) || slug,
        url: link.abs,
        status,
        hasNav: (await page.locator('nav').count()) > 0,
        hasFooter: (await page.locator('footer').count()) > 0,
        screenshot: shot,
      });

      // Soft assertions so one bad page doesn't abort the sweep or skip the report.
      expect.soft(status, `${link.raw} should return HTTP 200`).toBe(200);
      expect.soft(hasErrorText, `${link.raw} shows error text on the page`).toBeFalsy();
    });
  }

  await test.step('Return to the home page', async () => {
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#contact-form')).toBeAttached();
  });

  await test.step('Empty contact form is blocked by required-field validation', async () => {
    await page.locator('#contact').scrollIntoViewIfNeeded();
    await page.click('#contact-form .btn-submit');

    // The browser should refuse to submit: the form is invalid and the required
    // fields report valueMissing. No success status should appear.
    const formValid = await page.locator('#contact-form').evaluate((f) =>
      (f as HTMLFormElement).checkValidity()
    );
    expect(formValid, 'empty form should be invalid').toBeFalsy();

    const nameMissing = await page.locator('#cf-name').evaluate((el) =>
      (el as HTMLInputElement).validity.valueMissing
    );
    expect(nameMissing, 'name field should report valueMissing').toBeTruthy();

    await expect(page.locator('#form-status')).not.toHaveClass(/ok/);
    console.log('✓ Empty form submission was blocked by browser validation');
  });

  await test.step('Write the markdown QA report', async () => {
    const rows = results
      .map(
        (r) =>
          `| ${r.name} | ${r.url} | ${r.status ?? 'n/a'} | ${r.hasNav ? '✅' : '❌'} | ${
            r.hasFooter ? '✅' : '❌'
          } | ${r.screenshot} |`
      )
      .join('\n');

    const md =
      `# Leonistic — Browser QA Report\n\n` +
      `**Site:** ${SITE_URL}\n\n` +
      `**Pages checked:** ${results.length}\n\n` +
      `| Page name | URL | Status | Has nav | Has footer | Screenshot path |\n` +
      `| --- | --- | --- | --- | --- | --- |\n` +
      `${rows}\n`;

    writeFileSync(REPORT_PATH, md, 'utf8');
    console.log(`✓ Wrote QA report to ${REPORT_PATH}`);
    console.log('\n' + md);
  });
});
