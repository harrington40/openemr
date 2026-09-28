/**
 * Admin & License — training video recording.
 */
const R = require('../recorder-base');

(async () => {
  const { browser, context, page } = await R.startRecording('10-admin-license');
  try {
    await R.login(page);
    await R.goTo(page, '/admin', 'System Admin');
    await R.pause(1500);
    await R.scrollDown(page, 300);
    await R.goTo(page, '/license', 'License Management');
    await R.pause(1500);
    await R.goTo(page, '/db-admin', 'Database Admin');
    await R.pause(1500);
    console.log('✅ Admin recording complete');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await R.finish(browser, context);
  }
})();
