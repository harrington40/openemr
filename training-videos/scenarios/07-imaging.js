/**
 * DICOM / Imaging — training video recording.
 */
const R = require('../recorder-base');

(async () => {
  const { browser, context, page } = await R.startRecording('07-imaging-dicom');
  try {
    await R.login(page);
    await R.goTo(page, '/dicom', 'DICOM / X-Ray Viewer');
    await R.pause(1500);
    await R.scrollDown(page, 300);
    console.log('✅ Imaging recording complete');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await R.finish(browser, context);
  }
})();
