import { runBriefing } from '../lib/briefing.js';

const cronSecret = process.env.CRON_SECRET;

export default async function handler(req, res) {
  // When CRON_SECRET is set, Vercel Cron passes it as a bearer token — enforce it.
  if (cronSecret) {
    const auth = req.headers.authorization || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized.' });
    }
  }

  try {
    const result = await runBriefing();
    return res.status(200).json(result);
  } catch (err) {
    console.error('Summary failed:', err);
    return res.status(500).json({ error: 'Could not generate the summary.' });
  }
}
