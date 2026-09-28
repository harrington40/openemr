/**
 * Help & How-To — training video recording.
 */
const R = require('../recorder-base');

(async () => {
  const { browser, context, page } = await R.startRecording('11-help-howto');
  try {
    await R.login(page);
    await R.goTo(page, '/how-to', 'How-To Guide');
    await R.pause(1000);
    await R.scrollDown(page, 400);
    await R.pause(1000);

    // Show watch mode if available
    try {
      const watchBtn = page.locator('button', { hasText: 'Watch Guide' }).first();
      if (await watchBtn.isVisible()) { await watchBtn.click(); await R.pause(3000); }
    } catch {}

    await R.goTo(page, '/wiki', 'Wiki / Documentation');
    await R.pause(1500);
    await R.goTo(page, '/help', 'FAQ & Help');
    await R.pause(1500);

    console.log('✅ Help recording complete');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await R.finish(browser, context);
  }
})();
