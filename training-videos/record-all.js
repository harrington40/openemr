#!/usr/bin/env node
/**
 * Master runner — records training videos for ALL OpenRx features.
 *
 * Usage:
 *   node record-all.js             # Record all 11 videos
 *   node record-all.js --feature=dashboard  # Record a single feature
 *
 * Output: training-videos/videos/*.webm
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const VIDEO_DIR = path.join(__dirname, 'videos');
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });

const scenarios = [
  { name: '01-dashboard', file: 'scenarios/01-dashboard.js', label: 'Dashboard & Navigation' },
  { name: '02-patients', file: 'scenarios/02-patients.js', label: 'Patient Search & Registration' },
  { name: '03-providers', file: 'scenarios/03-providers.js', label: 'Provider Management' },
  { name: '04-appointments', file: 'scenarios/04-appointments.js', label: 'Appointments & Scheduling' },
  { name: '05-labs', file: 'scenarios/05-labs.js', label: 'Lab Orders & Results' },
  { name: '06-documents', file: 'scenarios/06-documents.js', label: 'Secure Documents' },
  { name: '07-imaging', file: 'scenarios/07-imaging.js', label: 'Imaging & DICOM' },
  { name: '08-billing', file: 'scenarios/08-billing.js', label: 'Billing & Claims' },
  { name: '09-reports', file: 'scenarios/09-reports.js', label: 'Reports & Analytics' },
  { name: '10-admin', file: 'scenarios/10-admin.js', label: 'Admin & License' },
  { name: '11-help', file: 'scenarios/11-help.js', label: 'Help & How-To Guide' },
];

const args = process.argv.slice(2);
const featureFlag = args.find(a => a.startsWith('--feature='));
const targetFeature = featureFlag ? featureFlag.split('=')[1] : null;

const toRecord = targetFeature
  ? scenarios.filter(s => s.name.includes(targetFeature) || s.file.includes(targetFeature))
  : scenarios;

if (toRecord.length === 0) {
  console.error(`❌ No scenario found for feature: ${targetFeature}`);
  console.error('Available features:', scenarios.map(s => s.name).join(', '));
  process.exit(1);
}

console.log('🎬 OpenRx Training Video Recorder');
console.log(`📁 Output: ${VIDEO_DIR}/`);
console.log(`🎯 Target: ${targetFeature || 'ALL features'}`);
console.log(`📹 Videos to record: ${toRecord.length}\n`);

let success = 0;
let failed = 0;

for (const scenario of toRecord) {
  const scenarioPath = path.join(__dirname, scenario.file);
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`🎥 [${scenario.name}] ${scenario.label}`);
  console.log(`${'═'.repeat(60)}`);

  try {
    execSync(`node "${scenarioPath}"`, {
      stdio: 'inherit',
      timeout: 120000, // 2 min per video
      env: { ...process.env, VIDEO_DIR },
    });
    success++;
    console.log(`✅ [${scenario.name}] Completed successfully`);
  } catch (err) {
    failed++;
    console.error(`❌ [${scenario.name}] Failed: ${err.message}`);
  }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`📊 Summary: ${success} succeeded, ${failed} failed`);
console.log(`📁 Videos saved in: ${VIDEO_DIR}/`);

// List generated videos
if (fs.existsSync(VIDEO_DIR)) {
  const files = fs.readdirSync(VIDEO_DIR).filter(f => f.endsWith('.webm'));
  if (files.length > 0) {
    console.log('\n📹 Generated videos:');
    files.forEach(f => {
      const stat = fs.statSync(path.join(VIDEO_DIR, f));
      const sizeMB = (stat.size / 1024 / 1024).toFixed(1);
      console.log(`  - ${f} (${sizeMB} MB)`);
    });
  }
}

process.exit(failed > 0 ? 1 : 0);
