/**
 * Dashboard & Navigation — training video recording.
 * Records: login → dashboard overview → provider dashboard → sidebar navigation
 */
const R = require('../recorder-base');

(async () => {
  const { browser, context, page } = await R.startRecording('01-dashboard-navigation');
  try {
    await R.login(page);

    // Clinic Overview Dashboard
    await R.goTo(page, '/dashboard', 'Clinic Overview Dashboard');
    await R.scrollDown(page, 300);
    await R.pause(1500);

    // Provider Dashboard
    await R.goTo(page, '/provider-dashboard', 'Provider My Dashboard');
    await R.scrollDown(page, 400);
    await R.pause(1500);

    // Sidebar navigation — expand sections
    console.log('  📂 Exploring sidebar menu...');
    const sections = ['Patients', 'Appointments', 'Clinical', 'Documents', 'Reports'];
    for (const section of sections) {
      try {
        const btn = page.locator('button', { hasText: section }).first();
        if (await btn.isVisible()) { await btn.click(); await R.pause(1000); }
      } catch {}
    }
    await R.pause(1000);

    console.log('✅ Dashboard & Navigation recording complete');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await R.finish(browser, context);
  }
})();
