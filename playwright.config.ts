import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

// `import 'dotenv/config'` loads .env so tests can read process.env.SUPABASE_URL
// and process.env.SUPABASE_ANON_KEY.

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
