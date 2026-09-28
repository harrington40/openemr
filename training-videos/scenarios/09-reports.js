/**
 * Reports — training video recording.
 */
const R = require('../recorder-base');

(async () => {
  const { browser, context, page } = await R.startRecording('09-reports');
  try {
    await R.login(page);
    await R.goTo(page, '/reports', 'Reports & Analytics');
    await R.pause(1500);
    await R.scrollDown(page, 300);
    console.log('✅ Reports recording complete');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await R.finish(browser, context);
  }
})();
