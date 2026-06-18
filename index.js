import cron from 'node-cron';
import { runBriefing } from './lib/briefing.js';

// Every day at 7:00 AM, in the machine's local time zone.
const SCHEDULE = '0 7 * * *';
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

async function trigger() {
  console.log(`[briefing] triggered at ${new Date().toLocaleString()}`);
  try {
    const result = await runBriefing();
    console.log('[briefing] done:', result);
  } catch (err) {
    console.error('[briefing] failed:', err);
  }
}

cron.schedule(SCHEDULE, trigger);

console.log(`[briefing] scheduler started — runs daily at 7:00 AM (${tz}).`);
console.log('[briefing] process will stay alive until stopped (Ctrl+C).');
