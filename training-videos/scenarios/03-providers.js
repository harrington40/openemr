/**
 * Providers Management — training video recording.
 */
const R = require('../recorder-base');

(async () => {
  const { browser, context, page } = await R.startRecording('03-providers');
  try {
    await R.login(page);
    await R.goTo(page, '/providers', 'Provider Management');

    // Provider table
    await R.pause(1500);

    // Show add provider form
    try {
      const addBtn = page.locator('button', { hasText: /Add Provider/i }).first();
      if (await addBtn.isVisible()) { await addBtn.click(); await R.pause(1000); }
    } catch {}

    // Scroll through form
    await R.scrollDown(page, 600);
    await R.pause(1000);
    await R.scrollDown(page, 600);
    await R.pause(1000);

    console.log('✅ Provider Management recording complete');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await R.finish(browser, context);
  }
})();
