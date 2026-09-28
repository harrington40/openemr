/**
 * Labs Orders & Results — training video recording.
 */
const R = require('../recorder-base');

(async () => {
  const { browser, context, page } = await R.startRecording('05-labs');
  try {
    await R.login(page);
    await R.goTo(page, '/labs', 'Lab Orders & Results');

    await R.scrollDown(page, 400);
    await R.pause(1500);

    console.log('✅ Labs recording complete');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await R.finish(browser, context);
  }
})();
