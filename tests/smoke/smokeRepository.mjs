import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Asserts that the directory is strictly a disposable CapTerm-owned temporary directory.
 * Prevents running mutation tests in the real repo, home dir, or arbitrary paths.
 */
export function assertSmokeRepoSafe(dir) {
  const resolved = path.resolve(dir);
  const isTmp =
    resolved.startsWith('/tmp/capterm-agent-smoke-') ||
    resolved.startsWith('/private/tmp/capterm-agent-smoke-') ||
    resolved.startsWith('/tmp/capterm-') ||
    resolved.startsWith('/private/tmp/capterm-');

  if (!isTmp) {
    throw new Error(
      `SAFETY VIOLATION: Directory "${resolved}" is not a CapTerm-owned temporary directory. Refusing to run smoke test.`,
    );
  }

  // Explicit check against the current project directory or home directory
  if (
    resolved === process.cwd() ||
    resolved.includes('traceRelay') ||
    resolved === process.env.HOME
  ) {
    throw new Error(
      `SAFETY VIOLATION: Target directory "${resolved}" touches real user project or home dir.`,
    );
  }
}

/**
 * Creates a disposable, temporary git repository for smoke testing.
 */
export async function createSmokeRepository(idSuffix) {
  const id = idSuffix ?? `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const dir = path.join('/tmp', `capterm-agent-smoke-${id}`);

  assertSmokeRepoSafe(dir);

  // Create directory
  fs.mkdirSync(dir, { recursive: true });

  // Initialize git repo
  try {
    execFileSync('git', ['init', '--quiet'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'smoke@capterm.local'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'CapTerm Smoke Test'], { cwd: dir });
  } catch {
    // If git fails in a restricted environment, continue with filesystem
  }

  // Create minimal project structure
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      {
        name: 'capterm-smoke-fixture',
        version: '1.0.0',
        private: true,
        scripts: {
          test: 'node tests/example.test.js',
        },
      },
      null,
      2,
    ),
    'utf8',
  );

  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src', 'example.ts'),
    'export function add(a: number, b: number): number {\n  return a + b;\n}\n',
    'utf8',
  );

  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'tests', 'example.test.ts'),
    'import { add } from "../src/example";\nif (add(1, 2) !== 3) process.exit(1);\n',
    'utf8',
  );

  try {
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-m', 'Initial commit', '--quiet'], { cwd: dir });
  } catch {
    // Optional initial commit
  }

  const cleanup = async () => {
    assertSmokeRepoSafe(dir);
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error if already removed
    }
  };

  return {
    dir,
    cleanup,
  };
}
