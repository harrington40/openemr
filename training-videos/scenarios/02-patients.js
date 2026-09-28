/**
 * Patient Search & Registration — training video recording.
 */
const R = require('../recorder-base');

(async () => {
  const { browser, context, page } = await R.startRecording('02-patient-search-register');
  try {
    await R.login(page);
    await R.goTo(page, '/patients', 'Patient Search & Register');

    // Show search functionality
    try { await R.type(page, 'input[placeholder*="Search"]', 'Smith', 'Search field'); } catch {}
    await R.pause(1500);
    try { await page.fill('input[placeholder*="Search"]', ''); } catch {}

    // Show registration button
    try {
      const addBtn = page.locator('button', { hasText: /Add Patient|Register|New Patient/i }).first();
      if (await addBtn.isVisible()) { await addBtn.click(); await R.pause(1500); }
    } catch {}

    // Show registration form fields
    await R.scrollDown(page, 300);
    await R.pause(1000);

    console.log('✅ Patient Search & Registration recording complete');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await R.finish(browser, context);
  }
})();
