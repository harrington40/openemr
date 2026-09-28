/**
 * Secure Documents — training video recording.
 */
const R = require('../recorder-base');

(async () => {
  const { browser, context, page } = await R.startRecording('06-documents');
  try {
    await R.login(page);
    await R.goTo(page, '/documents', 'Secure Documents');

    await R.scrollDown(page, 300);
    await R.pause(1000);
    await R.scrollDown(page, 300);

    console.log('✅ Documents recording complete');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await R.finish(browser, context);
  }
})();
