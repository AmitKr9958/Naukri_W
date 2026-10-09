import 'dotenv/config';

const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
const chatId = process.env.TELEGRAM_CHAT_ID?.trim();

if (!token || !chatId) {
  console.error('Telegram test not sent: set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your local .env file.');
  process.exitCode = 1;
} else {
  const message = [
    '✅ <b>Naukri Job Watcher — Telegram test</b>',
    '',
    'Telegram delivery is reachable from this computer.',
    'This is a test message only; no job search was run and no job details were sent.',
    new Date().toLocaleString('en-IN', { timeZone: process.env.TZ || 'Asia/Kolkata' })
  ].join('\n');

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
        disable_web_page_preview: true
      }),
      signal: AbortSignal.timeout(Number(process.env.HTTP_TIMEOUT_MS || 30000))
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.ok !== true) {
      const description = typeof result.description === 'string' ? result.description : `HTTP ${response.status}`;
      console.error(`Telegram test failed: ${description}`);
      process.exitCode = 1;
    } else {
      console.log('Telegram test delivered successfully. Check the configured chat for the test message.');
    }
  } catch (error) {
    console.error(`Telegram test failed: ${error instanceof Error ? error.message : 'network error'}`);
    process.exitCode = 1;
  }
}
