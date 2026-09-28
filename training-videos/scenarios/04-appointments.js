/**
 * Appointments Calendar — training video recording.
 */
const R = require('../recorder-base');

(async () => {
  const { browser, context, page } = await R.startRecording('04-appointments');
  try {
    await R.login(page);
    await R.goTo(page, '/appointments', 'Appointment Calendar');

    await R.pause(1500);
    await R.scrollDown(page, 300);

    console.log('✅ Appointments recording complete');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await R.finish(browser, context);
  }
})();
