import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');

// APP-VERSION-001: the displayed version is whatever the Tauri app metadata reports.
let metadataCalls = 0;
let metadataVersion = '9.8.7-metadata';
const tauriApp = {
  getVersion: async () => {
    metadataCalls += 1;
    return metadataVersion;
  },
};

const src = fs.readFileSync(
  path.resolve(__dirname, '../app/src/features/workspace/appVersion.ts'),
  'utf8',
);
const js = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, (name) => {
  if (name === '@tauri-apps/api/app') return tauriApp;
  if (name === 'react') return { useEffect() {}, useState: (v) => [v, () => {}] };
  throw new Error(`unexpected import ${name}`);
});
const { readAppVersion } = mod.exports;

// 1. Outside Tauri (web dev server, tests) there is no app metadata: no version is shown.
globalThis.window = {};
assert.strictEqual(await readAppVersion(), null);
assert.strictEqual(metadataCalls, 0);

// 2. Inside Tauri the default source is the Tauri app metadata API, verbatim.
globalThis.window = { __TAURI_INTERNALS__: {} };
assert.strictEqual(await readAppVersion(), '9.8.7-metadata');
assert.strictEqual(metadataCalls, 1);
metadataVersion = '0.2.0';
assert.strictEqual(await readAppVersion(), '0.2.0', 'follows the metadata, not a literal');

// 3. Unreadable or empty metadata shows nothing rather than a guessed version.
assert.strictEqual(await readAppVersion(async () => { throw new Error('ipc'); }), null);
assert.strictEqual(await readAppVersion(async () => '  '), null);

// 4. The bundle config does not duplicate the version: Tauri falls back to native/Cargo.toml.
const tauriConf = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '../native/tauri.conf.json'), 'utf8'),
);
assert.strictEqual(tauriConf.version, undefined);

console.log('appVersion001: all tests passed');
