#!/usr/bin/env node
/**
 * Upload recorded training videos to Backblaze B2 via the OpenRx API.
 * The videos will appear on the How-To page under "Video Tutorials".
 *
 * Usage:
 *   node upload-videos.js              # Upload all .webm files in videos/
 *   node upload-videos.js --file=01-dashboard-navigation.webm  # Upload a single file
 *
 * Prerequisites:
 *   - Videos must exist in training-videos/videos/
 *   - OpenRx must be running and accessible
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const BASE_URL = process.env.OPENRX_URL || 'https://openrx.transtechologies.com';
const USERNAME = process.env.OPENRX_USER || 'admin';
const PASSWORD = process.env.OPENRX_PASS || 'Cosinesine900**';
const VIDEO_DIR = path.join(__dirname, 'videos');

const args = process.argv.slice(2);
const fileFlag = args.find(a => a.startsWith('--file='));
const targetFile = fileFlag ? fileFlag.split('=')[1] : null;

/**
 * Simple HTTP request helper (no external deps).
 */
function request(method, urlPath, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, BASE_URL);
    const mod = url.protocol === 'https:' ? https : http;
    const opts = {
      method,
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Upload a file as multipart/form-data using Node built-ins.
 */
function uploadFile(urlPath, token, filePath, fileName) {
  return new Promise((resolve, reject) => {
    const boundary = '----OpenRxUpload' + Date.now();
    const url = new URL(urlPath, BASE_URL);
    const mod = url.protocol === 'https:' ? https : http;
    const fileBuffer = fs.readFileSync(filePath);

    // Build multipart form with file + category field
    const parts = [
      `--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nhowto-video\r\n`,
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: video/webm\r\n\r\n`,
    ];
    const header = Buffer.from(parts.join(''));
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, fileBuffer, footer]);

    const opts = {
      method: 'POST',
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + '?category=howto-video',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };

    const req = mod.request(opts, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve({ success: true }); }
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  console.log('📤 OpenRx Training Video Uploader');
  console.log(`🌐 Target: ${BASE_URL}`);
  console.log(`📁 Source: ${VIDEO_DIR}/`);

  // 1. Login
  console.log('\n🔑 Logging in...');
  let loginResult;
  try {
    loginResult = await request('POST', '/api/auth/login', null, { username: USERNAME, password: PASSWORD });
  } catch (err) {
    console.error('❌ Login failed:', err.message);
    process.exit(1);
  }
  const token = loginResult.token;
  console.log(`✅ Logged in as ${USERNAME}`);

  // 2. Find videos
  const files = targetFile
    ? [targetFile]
    : fs.readdirSync(VIDEO_DIR).filter(f => f.endsWith('.webm'));

  if (files.length === 0) {
    console.log('\n❌ No .webm videos found in', VIDEO_DIR);
    console.log('Run "node record-all.js" first to generate training videos.');
    process.exit(1);
  }

  console.log(`\n📹 Uploading ${files.length} video(s)...\n`);

  // 3. Upload each video
  let uploaded = 0;
  let skipped = 0;

  for (const file of files) {
    const filePath = path.join(VIDEO_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.log(`  ⚠️  ${file} — file not found, skipping`);
      skipped++;
      continue;
    }

    const stat = fs.statSync(filePath);
    const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
    process.stdout.write(`  ⬆️  ${file} (${sizeMB} MB)... `);

    try {
      const result = await uploadFile('/api/documents/upload', token, filePath, file);
      console.log(`✅ ID: ${result.id || 'ok'}`);
      uploaded++;
    } catch (err) {
      console.log(`❌ ${err.message}`);
    }
  }

  console.log(`\n📊 Upload complete: ${uploaded} uploaded, ${skipped} skipped`);
  console.log(`🌐 View at: ${BASE_URL}/how-to (Video Tutorials section)`);
})();
