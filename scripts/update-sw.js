'use strict';

// Run after changing dist assets, before testing or packaging a release.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'dist');
const workerPath = path.join(root, 'sw.js');
const source = fs.readFileSync(workerPath, 'utf8');
const filesMatch = source.match(/const FILES = (\{[\s\S]*?\n\});/);
if (!filesMatch) throw new Error('Service-worker file list is missing.');
const files = Object.keys(vm.runInNewContext('(' + filesMatch[1] + ')'));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const hashes = Object.fromEntries(files.map(name => [name, sha256(fs.readFileSync(path.join(root, name)))]));
const bundle = sha256(JSON.stringify(hashes));
const block = '// BEGIN BUNDLE INTEGRITY\n' +
  `const BUNDLE_ID = '${bundle}';\n` +
  `const FILE_HASHES = ${JSON.stringify(hashes, null, 2)};\n` +
  '// END BUNDLE INTEGRITY';
const updated = source.replace(/\/\/ BEGIN BUNDLE INTEGRITY[\s\S]*?\/\/ END BUNDLE INTEGRITY/, block);
if (!source.includes('// BEGIN BUNDLE INTEGRITY')) throw new Error('Service-worker integrity block is missing.');
if (process.argv.includes('--check')) {
  if (updated !== source) { console.error('Offline file hashes are stale. Run node scripts/update-sw.js.'); process.exitCode = 1; }
  else console.log('Offline file hashes match all ' + files.length + ' assets.');
} else {
  fs.writeFileSync(workerPath, updated);
  console.log('Updated offline hashes for ' + files.length + ' assets.');
}
