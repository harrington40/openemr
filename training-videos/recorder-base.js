/**
 * Base utilities for Playwright training video recording.
 * Records browser sessions as .webm videos for OpenRx training.
 */
const { chromium } = require('playwright');

const BASE_URL = process.env.OPENRX_URL || 'https://openrx.transtechologies.com';
const USERNAME = process.env.OPENRX_USER || 'admin';
const PASSWORD = process.env.OPENRX_PASS || 'Cosinesine900**';
const VIDEO_DIR = process.env.VIDEO_DIR || './videos';
const STEP_PAUSE = 2000; // ms to pause between actions for clarity
const SLOW_MO = 800;    // ms of slow-motion per action

/**
 * Start a recording session.
 * @returns {{ browser, context, page }}
 */
async function startRecording(videoName) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: {
      dir: VIDEO_DIR,
      size: { width: 1440, height: 900 },
    },
  });
  const page = await context.newPage();
  // Rename video after close
  page.on('close', async () => {
    const video = page.video();
    if (video) {
      const path = await video.path();
      const fs = require('fs');
      const newPath = `${VIDEO_DIR}/${videoName}.webm`;
      if (path && fs.existsSync(path)) {
        fs.renameSync(path, newPath);
        console.log(`  ✅ Video saved: ${newPath}`);
      }
    }
  });
  return { browser, context, page };
}

/**
 * Log into OpenRx.
 */
async function login(page) {
  console.log('  🔑 Logging in...');
  await page.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await page.fill('input[type="text"]', USERNAME);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL('**/dashboard', { timeout: 15000 });
  await page.waitForTimeout(STEP_PAUSE);
  console.log('  ✅ Logged in');
}

/**
 * Navigate to a page and wait for it to load.
 */
async function goTo(page, path, label) {
  console.log(`  📍 Navigating to: ${label}`);
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(STEP_PAUSE);
}

/**
 * Pause for dramatic effect / let content render.
 */
async function pause(ms = STEP_PAUSE) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Highlight and click an element (for visual clarity).
 */
async function click(page, selector, label) {
  console.log(`  🖱️  Click: ${label}`);
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.hover(selector);
  await page.waitForTimeout(500);
  await page.click(selector);
  await page.waitForTimeout(STEP_PAUSE);
}

/**
 * Type into a field.
 */
async function type(page, selector, text, label) {
  console.log(`  ⌨️  Type into: ${label} → "${text}"`);
  await page.waitForSelector(selector, { timeout: 10000 });
  await page.click(selector);
  await page.fill(selector, text);
  await page.waitForTimeout(800);
}

/**
 * Scroll down the page smoothly.
 */
async function scrollDown(page, pixels = 400) {
  await page.evaluate((px) => window.scrollBy({ top: px, behavior: 'smooth' }), pixels);
  await page.waitForTimeout(1000);
}

/**
 * Finish recording and close browser.
 */
async function finish(browser, context) {
  await context.close();
  await browser.close();
}

module.exports = {
  BASE_URL, USERNAME, PASSWORD, VIDEO_DIR, STEP_PAUSE, SLOW_MO,
  startRecording, login, goTo, pause, click, type, scrollDown, finish,
};
