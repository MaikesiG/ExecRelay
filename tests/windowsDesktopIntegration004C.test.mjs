import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);
const ts = require('../app/node_modules/typescript');

function load(relativePath) {
  const src = fs.readFileSync(path.resolve(__dirname, relativePath), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
  return mod.exports;
}

const { getTerminalPaneDisplayTitle } = load('../app/src/features/workspace/types.ts');
const { resolveWorkspaceFolderBasename } = load(
  '../app/src/features/workspace/workspaceContext.ts',
);

const paneWithCwd = (cwd) => ({ session: { sessionInfo: { cwd } } });

// 1. A Windows session cwd titles the pane with its folder name, not the whole path.
for (const [cwd, expected] of [
  ['C:\\Users\\maike\\Documents\\uControl', 'uControl'],
  ['C:\\Users\\maike\\Documents\\My Test Folder', 'My Test Folder'],
  ['C:\\Users\\maike\\Documents\\测试 文件夹', '测试 文件夹'],
  ['C:\\Users\\maike\\Documents\\uControl\\', 'uControl'],
  ['C:/Users/maike/Documents/uControl', 'uControl'],
]) {
  assert.strictEqual(getTerminalPaneDisplayTitle(paneWithCwd(cwd)), expected, cwd);
  // Same folder name as the workspace tab derives from the bound folder.
  assert.strictEqual(resolveWorkspaceFolderBasename(cwd), expected, cwd);
}

// 2. POSIX behavior is unchanged.
assert.strictEqual(getTerminalPaneDisplayTitle(paneWithCwd('/home/user/my project')), 'my project');
assert.strictEqual(getTerminalPaneDisplayTitle(paneWithCwd('/')), '/');
assert.strictEqual(getTerminalPaneDisplayTitle({ customTitle: 'logs', ...paneWithCwd('C:\\x') }), 'logs');

console.log('windowsDesktopIntegration004C: all tests passed');
