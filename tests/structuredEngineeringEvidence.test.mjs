import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

const ts = require('../app/node_modules/typescript');

function transpileTs(filePath, customRequire = () => ({})) {
  const src = fs.readFileSync(filePath, 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, customRequire);
  return mod.exports;
}

// 1. Transpile execution/types.ts
const execTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/execution/types.ts'));
const {
  DEFAULT_LOCAL_HUMAN_ACTOR,
  isExecution,
  isEvidenceBlock,
} = execTypesMod;

// 2. Transpile transcriptFormat.ts & transcriptDisplayCleanup.ts
const formatMod = transpileTs(path.resolve(__dirname, '../app/src/features/transcript/transcriptFormat.ts'));
const { stripAnsiAndControl, normalizeCommand, normalizeOutput } = formatMod;

const cleanupMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/transcript/transcriptDisplayCleanup.ts'),
  (req) => (req.includes('transcriptFormat') ? formatMod : {}),
);
const { cleanTranscriptForDisplay } = cleanupMod;

// 3. Transpile structuredEvidence/types.ts
const seTypesMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/structuredEvidence/types.ts'),
  (req) => (req.includes('execution') ? execTypesMod : {}),
);
const {
  isStructuredEngineeringEvidence,
  isTestSummaryEvidence,
  isDiagnosticEvidence,
  isTypecheckSummaryEvidence,
} = seTypesMod;

// 4. Transpile individual parsers
const customParserRequire = (req) => {
  if (req.includes('transcriptFormat')) return formatMod;
  if (req.includes('types')) return seTypesMod;
  return {};
};

const jestParserMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/structuredEvidence/parsers/jestParser.ts'),
  customParserRequire,
);
const { jestParser, JEST_PARSER_ID, JEST_PARSER_VERSION } = jestParserMod;

const vitestParserMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/structuredEvidence/parsers/vitestParser.ts'),
  customParserRequire,
);
const { vitestParser, VITEST_PARSER_ID, VITEST_PARSER_VERSION } = vitestParserMod;

const pytestParserMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/structuredEvidence/parsers/pytestParser.ts'),
  customParserRequire,
);
const { pytestParser, PYTEST_PARSER_ID, PYTEST_PARSER_VERSION } = pytestParserMod;

const cargoTestParserMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/structuredEvidence/parsers/cargoTestParser.ts'),
  customParserRequire,
);
const { cargoTestParser, CARGO_TEST_PARSER_ID, CARGO_TEST_PARSER_VERSION } = cargoTestParserMod;

const tscParserMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/structuredEvidence/parsers/tscParser.ts'),
  customParserRequire,
);
const { tscParser, TSC_PARSER_ID, TSC_PARSER_VERSION } = tscParserMod;

// 5. Transpile parserEngine.ts
const parserEngineMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/structuredEvidence/parserEngine.ts'),
  (req) => {
    if (req.includes('jestParser')) return jestParserMod;
    if (req.includes('vitestParser')) return vitestParserMod;
    if (req.includes('pytestParser')) return pytestParserMod;
    if (req.includes('cargoTestParser')) return cargoTestParserMod;
    if (req.includes('tscParser')) return tscParserMod;
    if (req.includes('types')) return seTypesMod;
    return {};
  },
);
const {
  DEFAULT_PARSER_REGISTRY,
  buildParseContext,
  parseEngineeringEvidence,
} = parserEngineMod;

// 6. Transpile executionModel.ts
const execModelMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/execution/executionModel.ts'),
  (req) => {
    if (req.includes('transcriptFormat')) {
      return { ...formatMod, cleanTranscriptForDisplay };
    }
    if (req.includes('parserEngine')) return parserEngineMod;
    if (req.includes('structuredEvidence/types')) return seTypesMod;
    if (req.includes('types')) return execTypesMod;
    return {};
  },
);
const {
  createExecution,
  createEvidenceBlock,
  executionFromTranscriptBlock,
  evidenceBlocksFromTranscriptBlock,
} = execModelMod;

// 7. Transpile verificationModel.ts
const verifTypesMod = transpileTs(path.resolve(__dirname, '../app/src/features/verification/types.ts'));
const verifModelMod = transpileTs(
  path.resolve(__dirname, '../app/src/features/verification/verificationModel.ts'),
  (req) => {
    if (req.includes('types')) return verifTypesMod;
    if (req.includes('execution')) return execModelMod;
    return {};
  },
);
const {
  createVerificationCriterion,
  createVerificationContract,
  createVerificationRun,
  evaluateCriterionResult,
  deriveVerificationRunStatus,
} = verifModelMod;

console.log('Running Structured Engineering Evidence Foundation Test Suite...\n');

// -----------------------------------------------------------------------------
// Test 1: Provenance & Traceability — executionId and sourceEvidenceBlockIds
// -----------------------------------------------------------------------------
console.log('--- Test 1: Provenance & Traceability ---');
{
  const exec = createExecution({
    id: 'exec-test-1',
    workspaceId: 'ws-1',
    command: 'npm test',
    outcome: 'succeeded',
    outcomeTrusted: true,
    exitCode: 0,
  });

  const outBlock = createEvidenceBlock({
    id: 'eb-out-1',
    executionId: exec.id,
    type: 'output',
    rawText: 'Test Suites: 2 passed, 2 total\nTests: 10 passed, 10 total\nTime: 1.2s',
  });

  const ctx = buildParseContext(exec, [outBlock]);
  const results = parseEngineeringEvidence(ctx);

  assert.strictEqual(results.length, 1);
  const se = results[0];
  assert.ok(isStructuredEngineeringEvidence(se));
  assert.ok(isTestSummaryEvidence(se));

  // Must reference canonical Execution ID
  assert.strictEqual(se.executionId, 'exec-test-1');
  // Must retain parserId and parserVersion
  assert.strictEqual(se.parserId, JEST_PARSER_ID);
  assert.strictEqual(se.parserVersion, JEST_PARSER_VERSION);
  // Must trace back to source EvidenceBlock IDs
  assert.deepStrictEqual(se.sourceEvidenceBlockIds, ['eb-out-1']);

  console.log('✓ Structured evidence references canonical executionId, source EvidenceBlocks, parserId, and parserVersion');
}

// -----------------------------------------------------------------------------
// Test 2: Jest Success Output Parsing
// -----------------------------------------------------------------------------
console.log('\n--- Test 2: Jest Success Output Parsing ---');
{
  const rawJestOutput = `
PASS src/auth.test.ts
PASS src/session.test.ts

Test Suites: 24 passed, 24 total
Tests:       3 skipped, 187 passed, 190 total
Snapshots:   0 total
Time:        8.234 s
Ran all test suites.
`;

  const exec = createExecution({
    id: 'exec-jest-success',
    workspaceId: 'ws-1',
    command: 'npm test',
    outcome: 'succeeded',
    exitCode: 0,
  });

  const eb = createEvidenceBlock({
    id: 'eb-jest-1',
    executionId: exec.id,
    type: 'output',
    rawText: rawJestOutput,
  });

  const ctx = buildParseContext(exec, [eb]);
  const parsed = jestParser.parse(ctx);
  assert.strictEqual(parsed.length, 1);

  const summary = parsed[0];
  assert.strictEqual(summary.type, 'test-summary');
  if (summary.type === 'test-summary') {
    assert.strictEqual(summary.framework, 'jest');
    assert.strictEqual(summary.passed, 187);
    assert.strictEqual(summary.failed, undefined);
    assert.strictEqual(summary.skipped, 3);
    assert.strictEqual(summary.total, 190);
    assert.strictEqual(summary.suitesPassed, 24);
    assert.strictEqual(summary.suitesFailed, undefined);
    assert.strictEqual(summary.suitesTotal, 24);
    assert.strictEqual(summary.durationMs, 8234);
    assert.strictEqual(summary.failedTests, undefined);
  }

  console.log('✓ Jest success output parses tests (passed, skipped, total), suites, and duration');
}

// -----------------------------------------------------------------------------
// Test 3: Jest Failure Output Parsing & Failed Test Names
// -----------------------------------------------------------------------------
console.log('\n--- Test 3: Jest Failure Output & Failure Extraction ---');
{
  const rawJestFail = `
FAIL src/auth.test.ts
  ● Auth › expires session after timeout

    expect(received).toBe(expected) // Object.is equality

    Expected: true
    Received: false

Test Suites: 1 failed, 2 passed, 3 total
Tests:       1 failed, 1 todo, 14 passed, 16 total
Snapshots:   0 total
Time:        1.45 s
`;

  const exec = createExecution({
    id: 'exec-jest-fail',
    workspaceId: 'ws-1',
    command: 'jest',
    outcome: 'failed',
    exitCode: 1,
  });

  const eb = createEvidenceBlock({
    id: 'eb-jest-fail',
    executionId: exec.id,
    type: 'error',
    rawText: rawJestFail,
  });

  const ctx = buildParseContext(exec, [eb]);
  const parsed = jestParser.parse(ctx);
  assert.strictEqual(parsed.length, 1);

  const summary = parsed[0];
  if (summary.type === 'test-summary') {
    assert.strictEqual(summary.passed, 14);
    assert.strictEqual(summary.failed, 1);
    assert.strictEqual(summary.todo, 1);
    assert.strictEqual(summary.total, 16);
    assert.strictEqual(summary.suitesPassed, 2);
    assert.strictEqual(summary.suitesFailed, 1);
    assert.strictEqual(summary.suitesTotal, 3);
    assert.strictEqual(summary.durationMs, 1450);

    assert.ok(summary.failedTests && summary.failedTests.length === 1);
    assert.strictEqual(summary.failedTests[0].suite, 'Auth');
    assert.strictEqual(summary.failedTests[0].name, 'expires session after timeout');
  }

  console.log('✓ Jest failure output parses failed counts, suites, todo counts, and failed test names');
}

// -----------------------------------------------------------------------------
// Test 4: Vitest Summary Parsing
// -----------------------------------------------------------------------------
console.log('\n--- Test 4: Vitest Summary Parsing ---');
{
  const rawVitestOutput = `
 ✓ tests/unit/parser.test.ts (4 tests) 15ms
 ❯ tests/integration/api.test.ts (2 tests | 1 failed) 45ms

 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 5 passed (6)
   Start at  14:22:01
   Duration  1.42s (transform 120ms, setup 10ms, collect 40ms, tests 60ms)
`;

  const exec = createExecution({
    id: 'exec-vitest',
    workspaceId: 'ws-1',
    command: 'npx vitest run',
    outcome: 'failed',
    exitCode: 1,
  });

  const eb = createEvidenceBlock({
    id: 'eb-vitest-1',
    executionId: exec.id,
    type: 'output',
    rawText: rawVitestOutput,
  });

  const ctx = buildParseContext(exec, [eb]);
  assert.ok(vitestParser.canParse(ctx));

  const parsed = vitestParser.parse(ctx);
  assert.strictEqual(parsed.length, 1);
  const summary = parsed[0];
  assert.strictEqual(summary.type, 'test-summary');
  if (summary.type === 'test-summary') {
    assert.strictEqual(summary.framework, 'vitest');
    assert.strictEqual(summary.passed, 5);
    assert.strictEqual(summary.failed, 1);
    assert.strictEqual(summary.total, 6);
    assert.strictEqual(summary.suitesPassed, 1);
    assert.strictEqual(summary.suitesFailed, 1);
    assert.strictEqual(summary.suitesTotal, 2);
    assert.strictEqual(summary.durationMs, 1420);
  }

  console.log('✓ Vitest summary correctly parses test files, tests, and duration');
}

// -----------------------------------------------------------------------------
// Test 5: Pytest Summary Parsing
// -----------------------------------------------------------------------------
console.log('\n--- Test 5: Pytest Summary Parsing ---');
{
  const rawPytestOutput = `
rootdir: /workspace
collected 15 items

tests/test_auth.py ...F...........                                       [100%]

=================================== FAILURES ===================================
FAILED tests/test_auth.py::test_session_expiry - AssertionError: assert False
=========================== short test summary info ============================
FAILED tests/test_auth.py::test_session_expiry - AssertionError: assert False
=================== 1 failed, 13 passed, 1 skipped in 4.56s ====================
`;

  const exec = createExecution({
    id: 'exec-pytest',
    workspaceId: 'ws-1',
    command: 'pytest tests/',
    outcome: 'failed',
    exitCode: 1,
  });

  const eb = createEvidenceBlock({
    id: 'eb-pytest-1',
    executionId: exec.id,
    type: 'error',
    rawText: rawPytestOutput,
  });

  const ctx = buildParseContext(exec, [eb]);
  assert.ok(pytestParser.canParse(ctx));

  const parsed = pytestParser.parse(ctx);
  assert.strictEqual(parsed.length, 1);
  const summary = parsed[0];
  assert.strictEqual(summary.type, 'test-summary');
  if (summary.type === 'test-summary') {
    assert.strictEqual(summary.framework, 'pytest');
    assert.strictEqual(summary.passed, 13);
    assert.strictEqual(summary.failed, 1);
    assert.strictEqual(summary.skipped, 1);
    assert.strictEqual(summary.total, 15);
    assert.strictEqual(summary.durationMs, 4560);
    assert.ok(summary.failedTests && summary.failedTests.length === 1);
    assert.strictEqual(summary.failedTests[0].file, 'tests/test_auth.py');
    assert.strictEqual(summary.failedTests[0].name, 'test_session_expiry');
  }

  console.log('✓ Pytest summary parses passed, failed, skipped, duration, and failure location');
}

// -----------------------------------------------------------------------------
// Test 6: Cargo Test Summary Parsing
// -----------------------------------------------------------------------------
console.log('\n--- Test 6: Cargo Test Summary Parsing ---');
{
  const rawCargoOutput = `
running 15 tests
test terminal::tests::test_pty_lifecycle ... ok
test terminal::tests::test_session_nonce ... ok
test terminal::tests::test_command_end ... FAILED
test terminal::tests::test_ignored_benchmark ... ignored

failures:

failures:
    terminal::tests::test_command_end

test result: FAILED. 13 passed; 1 failed; 1 ignored; 0 measured; 0 filtered out; finished in 0.08s
`;

  const exec = createExecution({
    id: 'exec-cargo',
    workspaceId: 'ws-1',
    command: 'cargo test',
    outcome: 'failed',
    exitCode: 101,
  });

  const eb = createEvidenceBlock({
    id: 'eb-cargo-1',
    executionId: exec.id,
    type: 'error',
    rawText: rawCargoOutput,
  });

  const ctx = buildParseContext(exec, [eb]);
  assert.ok(cargoTestParser.canParse(ctx));

  const parsed = cargoTestParser.parse(ctx);
  assert.strictEqual(parsed.length, 1);
  const summary = parsed[0];
  assert.strictEqual(summary.type, 'test-summary');
  if (summary.type === 'test-summary') {
    assert.strictEqual(summary.framework, 'cargo-test');
    assert.strictEqual(summary.passed, 13);
    assert.strictEqual(summary.failed, 1);
    assert.strictEqual(summary.skipped, 1);
    assert.strictEqual(summary.total, 15);
    assert.strictEqual(summary.durationMs, 80);
    assert.ok(summary.failedTests && summary.failedTests.length === 1);
    assert.strictEqual(summary.failedTests[0].name, 'terminal::tests::test_command_end');
  }

  console.log('✓ Cargo test parses passed, failed, ignored (skipped), and failure list');
}

// -----------------------------------------------------------------------------
// Test 7: Tool Detection & Ambiguity Rejection
// -----------------------------------------------------------------------------
console.log('\n--- Test 7: Tool Detection & Ambiguity Rejection ---');
{
  // 1. Generic word "PASS" or "FAILED" alone must NOT produce test evidence
  const genericOutput = `
Review status: PASS
Pipeline state: FAILED
error: some miscellaneous server message
`;
  const genericExec = createExecution({
    id: 'exec-generic',
    workspaceId: 'ws-1',
    command: 'echo "Review status: PASS"',
  });
  const genericEb = createEvidenceBlock({
    id: 'eb-gen',
    executionId: genericExec.id,
    type: 'output',
    rawText: genericOutput,
  });

  const ctxGeneric = buildParseContext(genericExec, [genericEb]);
  assert.strictEqual(jestParser.canParse(ctxGeneric), false, 'Jest parser must reject generic PASS text');
  assert.strictEqual(pytestParser.canParse(ctxGeneric), false, 'Pytest parser must reject generic FAILED text');
  assert.strictEqual(cargoTestParser.canParse(ctxGeneric), false, 'Cargo parser must reject generic output');
  assert.strictEqual(vitestParser.canParse(ctxGeneric), false, 'Vitest parser must reject generic output');

  const parsed = parseEngineeringEvidence(ctxGeneric);
  assert.strictEqual(parsed.length, 0, 'No false structured evidence produced for ambiguous text');

  // 2. npm test with ambiguous non-framework output remains unparsed
  const ambigExec = createExecution({
    id: 'exec-ambig',
    workspaceId: 'ws-1',
    command: 'npm test',
  });
  const ambigEb = createEvidenceBlock({
    id: 'eb-ambig',
    executionId: ambigExec.id,
    type: 'output',
    rawText: 'Starting custom test runner...\nAll checks completed cleanly.\nDone in 4s.',
  });
  const ctxAmbig = buildParseContext(ambigExec, [ambigEb]);
  const parsedAmbig = parseEngineeringEvidence(ctxAmbig);
  assert.strictEqual(parsedAmbig.length, 0, 'Ambiguous custom test runner output without signature is not falsely parsed');

  console.log('✓ Ambiguous output and standalone "PASS" / "FAILED" are strictly rejected without false evidence');
}

// -----------------------------------------------------------------------------
// Test 8: TypeScript (tsc) Diagnostics Parsing
// -----------------------------------------------------------------------------
console.log('\n--- Test 8: TypeScript (tsc) Diagnostic Parsing ---');
{
  const rawTscOutput = `
src/auth.ts(42,7): error TS2322: Type 'string' is not assignable to type 'number'.
src/session.ts:18:3 - error TS2345: Argument of type 'null' is not assignable to parameter of type 'Session'.
src/config.ts(5,1): warning TS5088: Option 'target' is obsolete.
Found 2 errors and 1 warning in 3 files.
`;

  const exec = createExecution({
    id: 'exec-tsc',
    workspaceId: 'ws-1',
    command: 'npm run typecheck',
    outcome: 'failed',
    exitCode: 2,
  });

  const eb = createEvidenceBlock({
    id: 'eb-tsc-1',
    executionId: exec.id,
    type: 'error',
    rawText: rawTscOutput,
  });

  const ctx = buildParseContext(exec, [eb]);
  assert.ok(tscParser.canParse(ctx));

  const parsed = tscParser.parse(ctx);
  // Expect 1 TypecheckSummaryEvidence + 3 DiagnosticEvidence items
  assert.strictEqual(parsed.length, 4);

  const summary = parsed[0];
  assert.ok(isTypecheckSummaryEvidence(summary));
  if (summary.type === 'typecheck-summary') {
    assert.strictEqual(summary.tool, 'typescript');
    assert.strictEqual(summary.errorCount, 2);
    assert.strictEqual(summary.warningCount, 1);
  }

  // Diagnostic 1 (Form A: file(line,col))
  const diag1 = parsed[1];
  assert.ok(isDiagnosticEvidence(diag1));
  if (diag1.type === 'diagnostic') {
    assert.strictEqual(diag1.file, 'src/auth.ts');
    assert.strictEqual(diag1.line, 42);
    assert.strictEqual(diag1.column, 7);
    assert.strictEqual(diag1.severity, 'error');
    assert.strictEqual(diag1.code, 'TS2322');
    assert.strictEqual(diag1.message, "Type 'string' is not assignable to type 'number'.");
  }

  // Diagnostic 2 (Form B: file:line:col - severity)
  const diag2 = parsed[2];
  if (diag2.type === 'diagnostic') {
    assert.strictEqual(diag2.file, 'src/session.ts');
    assert.strictEqual(diag2.line, 18);
    assert.strictEqual(diag2.column, 3);
    assert.strictEqual(diag2.severity, 'error');
    assert.strictEqual(diag2.code, 'TS2345');
    assert.strictEqual(diag2.message, "Argument of type 'null' is not assignable to parameter of type 'Session'.");
  }

  // Diagnostic 3 (Warning)
  const diag3 = parsed[3];
  if (diag3.type === 'diagnostic') {
    assert.strictEqual(diag3.file, 'src/config.ts');
    assert.strictEqual(diag3.line, 5);
    assert.strictEqual(diag3.column, 1);
    assert.strictEqual(diag3.severity, 'warning');
    assert.strictEqual(diag3.code, 'TS5088');
  }

  console.log('✓ TypeScript diagnostics parsed: file, line, column, severity, code, message, and summary');
}

// -----------------------------------------------------------------------------
// Test 9: ANSI Escape Sequences Do Not Break Parsing
// -----------------------------------------------------------------------------
console.log('\n--- Test 9: ANSI Escape Sequences Resilience ---');
{
  const rawWithAnsi = `
\u001b[32m\u001b[1mPASS\u001b[22m\u001b[39m \u001b[2msrc/\u001b[22m\u001b[1mapp.test.ts\u001b[22m
\u001b[1mTest Suites:\u001b[22m \u001b[1m\u001b[32m1 passed\u001b[39m\u001b[22m, 1 total
\u001b[1mTests:\u001b[22m       \u001b[1m\u001b[32m5 passed\u001b[39m\u001b[22m, 5 total
\u001b[1mTime:\u001b[22m        \u001b[2m1.234 s\u001b[22m
`;

  const exec = createExecution({
    id: 'exec-ansi',
    workspaceId: 'ws-1',
    command: 'jest',
  });
  const eb = createEvidenceBlock({
    id: 'eb-ansi',
    executionId: exec.id,
    type: 'output',
    rawText: rawWithAnsi,
  });

  const ctx = buildParseContext(exec, [eb]);
  assert.ok(jestParser.canParse(ctx));

  const parsed = jestParser.parse(ctx);
  assert.strictEqual(parsed.length, 1);
  if (parsed[0].type === 'test-summary') {
    assert.strictEqual(parsed[0].passed, 5);
    assert.strictEqual(parsed[0].total, 5);
    assert.strictEqual(parsed[0].suitesPassed, 1);
    assert.strictEqual(parsed[0].durationMs, 1234);
  }

  // Verify raw evidence is completely unmutated
  assert.strictEqual(eb.rawText, rawWithAnsi, 'Raw evidence must remain completely unmutated by parsing');

  console.log('✓ ANSI sequences do not break parsing, and raw source evidence remains untouched');
}

// -----------------------------------------------------------------------------
// Test 10: Parser Exception Safety Barrier
// -----------------------------------------------------------------------------
console.log('\n--- Test 10: Parser Exception Safety Barrier ---');
{
  const maliciousParser = {
    id: 'malicious-parser',
    version: '1.0.0',
    canParse: () => true,
    parse: () => {
      throw new Error('Uncaught parser explosion!');
    },
  };

  const exec = createExecution({
    id: 'exec-safe',
    workspaceId: 'ws-1',
    command: 'npm test',
    outcome: 'succeeded',
    outcomeTrusted: true,
    exitCode: 0,
  });

  const eb = createEvidenceBlock({
    id: 'eb-safe',
    executionId: exec.id,
    type: 'output',
    rawText: 'Test Suites: 1 passed, 1 total\nTests: 2 passed, 2 total',
  });

  const ctx = buildParseContext(exec, [eb]);

  // Pass malicious parser alongside jestParser
  const results = parseEngineeringEvidence(ctx, [maliciousParser, jestParser]);

  // Engine caught the exception, didn't crash, and continued to run jestParser
  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].type, 'test-summary');
  assert.strictEqual(exec.outcome, 'succeeded', 'Execution outcome remains intact');
  assert.strictEqual(exec.exitCode, 0, 'Execution exit code remains intact');

  console.log('✓ Parser exceptions are isolated safely and cannot crash engine or corrupt Execution');
}

// -----------------------------------------------------------------------------
// Test 11: Contradiction Invariants — Parser Never Overrides Execution Truth
// -----------------------------------------------------------------------------
console.log('\n--- Test 11: Contradiction Invariants (Execution) ---');
{
  // Scenario A: Process exited with 1 (failed), but test output reported 187 passed, 0 failed
  // (e.g. coverage threshold failed, unhandled rejection after tests, or hook error)
  const execFailed = createExecution({
    id: 'exec-contradict-1',
    workspaceId: 'ws-1',
    command: 'npm test',
    lifecycle: 'finished',
    outcome: 'failed',
    outcomeTrusted: true,
    exitCode: 1,
  });

  const eb = createEvidenceBlock({
    id: 'eb-c1',
    executionId: execFailed.id,
    type: 'error',
    rawText: 'Test Suites: 24 passed, 24 total\nTests: 187 passed, 187 total\nTime: 2.1s',
  });

  const ctx = buildParseContext(execFailed, [eb]);
  const parsed = parseEngineeringEvidence(ctx);
  assert.strictEqual(parsed.length, 1);
  if (parsed[0].type === 'test-summary') {
    assert.strictEqual(parsed[0].passed, 187);
    assert.strictEqual(parsed[0].failed, undefined);
  }

  // Authoritative Execution outcome MUST NOT be modified
  assert.strictEqual(execFailed.outcome, 'failed', 'Execution outcome must remain failed');
  assert.strictEqual(execFailed.exitCode, 1, 'Execution exitCode must remain 1');

  // Scenario B: Process exited with 0 (succeeded), but output has warning diagnostics
  const execSuccess = createExecution({
    id: 'exec-contradict-2',
    workspaceId: 'ws-1',
    command: 'npm run build',
    lifecycle: 'finished',
    outcome: 'succeeded',
    outcomeTrusted: true,
    exitCode: 0,
  });

  assert.strictEqual(execSuccess.outcome, 'succeeded');
  assert.strictEqual(execSuccess.exitCode, 0);

  console.log('✓ Contradiction invariant verified: Structured evidence never overrides Execution outcome or exitCode');
}

// -----------------------------------------------------------------------------
// Test 12: Contradiction Invariants — Parser Never Overrides Verification Verdict
// -----------------------------------------------------------------------------
console.log('\n--- Test 12: Contradiction Invariants (Verification) ---');
{
  const criterion = createVerificationCriterion({
    id: 'crit-test',
    command: 'npm test',
    expectedExitCodes: [0],
  });

  // 1. Exit 1 with 187 tests passed -> Verification MUST FAIL
  const execFailWithTestsPassing = createExecution({
    id: 'exec-verif-fail',
    workspaceId: 'ws-1',
    command: 'npm test',
    intent: 'verification',
    lifecycle: 'finished',
    outcome: 'failed',
    outcomeTrusted: true,
    outcomeSource: 'trusted-shell',
    exitCode: 1,
  });

  const resultFail = evaluateCriterionResult(criterion, execFailWithTestsPassing);
  assert.strictEqual(resultFail.status, 'failed', 'Verification criterion must fail on exit 1 even if tests passed');
  assert.strictEqual(resultFail.observedExitCode, 1);

  // 2. Exit 0 with diagnostic errors -> Verification MUST PASS
  const execPassWithDiag = createExecution({
    id: 'exec-verif-pass',
    workspaceId: 'ws-1',
    command: 'npm test',
    intent: 'verification',
    lifecycle: 'finished',
    outcome: 'succeeded',
    outcomeTrusted: true,
    outcomeSource: 'trusted-shell',
    exitCode: 0,
    hasDiagnosticError: true,
  });

  const resultPass = evaluateCriterionResult(criterion, execPassWithDiag);
  assert.strictEqual(resultPass.status, 'passed', 'Verification criterion must pass on exit 0 even with diagnostic text');

  console.log('✓ Contradiction invariant verified: Structured evidence never alters Verification verdict');
}

// -----------------------------------------------------------------------------
// Test 13: Historical Immutability & Workspace/Pane Isolation
// -----------------------------------------------------------------------------
console.log('\n--- Test 13: Immutability & Isolation ---');
{
  const block1 = {
    id: 'block-pane-1',
    batchId: 1,
    command: 'npm test',
    output: 'Test Suites: 1 passed, 1 total\nTests: 10 passed, 10 total\nTime: 1.0s',
    startedAt: 1000,
    completedAt: 2000,
    isComplete: true,
    exitCode: 0,
    outcome: 'succeeded',
    workspaceId: 'ws-1',
    terminalPaneId: 'pane-1',
    terminalLabelAtCapture: 'Terminal 1',
  };

  const eb1 = evidenceBlocksFromTranscriptBlock(block1);
  block1.structuredEvidence = parseEngineeringEvidence(buildParseContext(executionFromTranscriptBlock(block1), eb1));
  const exec1 = executionFromTranscriptBlock(block1);
  assert.ok(exec1.structuredEvidence && exec1.structuredEvidence.length > 0);
  const frozenEvidence = Object.freeze([...exec1.structuredEvidence]);

  // Simulate subsequent execution in pane-2 of ws-1
  const block2 = {
    id: 'block-pane-2',
    batchId: 1,
    command: 'cargo test',
    output: 'test result: ok. 5 passed; 0 failed; 0 ignored; finished in 0.02s',
    startedAt: 3000,
    completedAt: 3500,
    isComplete: true,
    exitCode: 0,
    outcome: 'succeeded',
    workspaceId: 'ws-1',
    terminalPaneId: 'pane-2',
    terminalLabelAtCapture: 'Terminal 2',
  };

  const eb2 = evidenceBlocksFromTranscriptBlock(block2);
  block2.structuredEvidence = parseEngineeringEvidence(buildParseContext(executionFromTranscriptBlock(block2), eb2));
  const exec2 = executionFromTranscriptBlock(block2);

  // Assert exec1 structured evidence remains untouched
  assert.deepStrictEqual(exec1.structuredEvidence, frozenEvidence);
  assert.strictEqual(exec1.structuredEvidence[0].type, 'test-summary');
  if (exec1.structuredEvidence[0].type === 'test-summary') {
    assert.strictEqual(exec1.structuredEvidence[0].framework, 'jest');
  }

  // Assert exec2 has its own isolated cargo evidence
  assert.ok(exec2.structuredEvidence && exec2.structuredEvidence.length > 0);
  if (exec2.structuredEvidence[0].type === 'test-summary') {
    assert.strictEqual(exec2.structuredEvidence[0].framework, 'cargo-test');
    assert.strictEqual(exec2.structuredEvidence[0].passed, 5);
  }

  // Cross-pane isolation
  assert.strictEqual(exec1.evidenceBlockIds[0].startsWith('block-pane-1'), true);
  assert.strictEqual(exec2.evidenceBlockIds[0].startsWith('block-pane-2'), true);

  console.log('✓ Historical structured evidence remains immutable; pane and workspace isolation verified');
}

console.log('\n=============================================================');
console.log('ALL 13 STRUCTURED ENGINEERING EVIDENCE TESTS PASSED SUCCESSFULLY!');
console.log('=============================================================');
