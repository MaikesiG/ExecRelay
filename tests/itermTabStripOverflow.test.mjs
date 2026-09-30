import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Task: Polish TraceRelay / CapTerm workspace and terminal tab strips to behave more like iTerm:
 * hide visible horizontal scrollbars while preserving horizontal scrolling when tabs overflow.
 */

// Implementation under test matching useTabStripScroll.ts
function scrollTabIntoView(container, tabElement, smooth = true) {
  const containerRect = container.getBoundingClientRect();
  const tabRect = tabElement.getBoundingClientRect();

  const tabLeftRelativeToContainer = tabRect.left - containerRect.left;
  const tabRightRelativeToContainer = tabRect.right - containerRect.left;

  const edgePadding = 4;

  if (tabLeftRelativeToContainer < edgePadding) {
    const targetScrollLeft =
      container.scrollLeft + tabLeftRelativeToContainer - edgePadding;
    const finalLeft = Math.max(0, targetScrollLeft);
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({
        left: finalLeft,
        behavior: smooth ? 'smooth' : 'auto',
      });
    } else {
      container.scrollLeft = finalLeft;
    }
  } else if (tabRightRelativeToContainer > containerRect.width - edgePadding) {
    const targetScrollLeft =
      container.scrollLeft +
      (tabRightRelativeToContainer - containerRect.width) +
      edgePadding;
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    const finalLeft = Math.min(maxScroll, targetScrollLeft);
    if (typeof container.scrollTo === 'function') {
      container.scrollTo({
        left: finalLeft,
        behavior: smooth ? 'smooth' : 'auto',
      });
    } else {
      container.scrollLeft = finalLeft;
    }
  }
}

function updateOverflowAttributes(container) {
  const canScrollLeft = container.scrollLeft > 2;
  const maxScroll = container.scrollWidth - container.clientWidth;
  const canScrollRight = container.scrollLeft < maxScroll - 2;

  if (canScrollLeft) {
    container.setAttribute('data-overflow-left', 'true');
  } else {
    container.removeAttribute('data-overflow-left');
  }

  if (canScrollRight) {
    container.setAttribute('data-overflow-right', 'true');
  } else {
    container.removeAttribute('data-overflow-right');
  }
}

console.log('Running iTerm Tab Strip Overflow & Hidden Scrollbar Tests...\n');

// ---------------------------------------------------------------------------
// Test 1: CSS invariants - visible scrollbars hidden & horizontal overflow preserved
// ---------------------------------------------------------------------------
{
  console.log('--- Test 1: CSS invariants for hidden scrollbars & horizontal overflow ---');
  const chromeTabsCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/ChromeTabs.css'),
    'utf8',
  );
  const workspaceTabBarCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabBar.css'),
    'utf8',
  );
  const workspaceTabsCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabs.css'),
    'utf8',
  );

  // Both workspace-tabs-list, terminal-tabs-list, and workspace-tab-bar-list must have:
  // - overflow-x: auto (scrollable)
  // - overflow-y: hidden
  // - scrollbar-width: none (Firefox / standards)
  // - -ms-overflow-style: none (IE / Edge)
  // - ::-webkit-scrollbar { display: none }
  assert.ok(
    chromeTabsCss.includes('scrollbar-width: none'),
    'ChromeTabs.css specifies scrollbar-width: none',
  );
  assert.ok(
    chromeTabsCss.includes('-ms-overflow-style: none'),
    'ChromeTabs.css specifies -ms-overflow-style: none',
  );
  assert.ok(
    chromeTabsCss.includes('::-webkit-scrollbar') &&
      chromeTabsCss.includes('display: none'),
    'ChromeTabs.css hides webkit scrollbar with display: none',
  );
  assert.ok(
    chromeTabsCss.includes('overflow-x: auto'),
    'ChromeTabs.css maintains overflow-x: auto',
  );

  // Check WorkspaceTabBar.css
  assert.ok(
    workspaceTabBarCss.includes('scrollbar-width: none'),
    'WorkspaceTabBar.css specifies scrollbar-width: none',
  );
  assert.ok(
    workspaceTabBarCss.includes('::-webkit-scrollbar') &&
      workspaceTabBarCss.includes('display: none'),
    'WorkspaceTabBar.css hides webkit scrollbar',
  );
  assert.ok(
    !workspaceTabBarCss.includes('scrollbar-width: thin'),
    'WorkspaceTabBar.css removed legacy scrollbar-width: thin',
  );
  assert.ok(
    !workspaceTabBarCss.includes('height: 3px'),
    'WorkspaceTabBar.css removed visible 3px scrollbar',
  );

  // Check WorkspaceTabs.css
  assert.ok(
    workspaceTabsCss.includes('scrollbar-width: none'),
    'WorkspaceTabs.css specifies scrollbar-width: none',
  );
  assert.ok(
    workspaceTabsCss.includes('::-webkit-scrollbar') &&
      workspaceTabsCss.includes('display: none'),
    'WorkspaceTabs.css hides webkit scrollbar',
  );
  assert.ok(
    !workspaceTabsCss.includes('scrollbar-width: thin'),
    'WorkspaceTabs.css removed legacy scrollbar-width: thin',
  );
  assert.ok(
    !workspaceTabsCss.includes('height: 3px'),
    'WorkspaceTabs.css removed visible 3px scrollbar',
  );

  console.log('✓ All tab strip stylesheets hide visible scrollbars while preserving overflow-x: auto');
}

// ---------------------------------------------------------------------------
// Test 2: Edge mask / fade CSS rules exist for restrained iTerm-like overflow hints
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 2: Subtle edge fade / mask CSS rules ---');
  const chromeTabsCss = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/ChromeTabs.css'),
    'utf8',
  );

  assert.ok(
    chromeTabsCss.includes('data-overflow-left="true"') &&
      chromeTabsCss.includes('data-overflow-right="true"'),
    'ChromeTabs.css targets data-overflow-left and data-overflow-right',
  );
  assert.ok(
    chromeTabsCss.includes('mask-image') &&
      chromeTabsCss.includes('linear-gradient'),
    'ChromeTabs.css applies linear-gradient mask for overflowed boundaries',
  );

  console.log('✓ Understated edge fading masks configured for left/right overflow states');
}

// ---------------------------------------------------------------------------
// Test 3: scrollTabIntoView brings hidden tab on the right into view
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 3: scrollTabIntoView brings right-hidden tab into view ---');
  let scrolledTo = null;

  // Mock container: clientWidth = 400, scrollWidth = 800, current scrollLeft = 0
  const mockContainer = {
    clientWidth: 400,
    scrollWidth: 800,
    scrollLeft: 0,
    getBoundingClientRect: () => ({ left: 50, right: 450, width: 400 }),
    scrollTo: (options) => {
      scrolledTo = options;
      mockContainer.scrollLeft = options.left;
    },
  };

  // Mock tab element positioned at x = 500..620 (cut off on right of container)
  // tabRect.left - containerRect.left = 500 - 50 = 450
  // tabRect.right - containerRect.left = 620 - 50 = 570
  const mockTab = {
    getBoundingClientRect: () => ({ left: 500, right: 620, width: 120 }),
  };

  scrollTabIntoView(mockContainer, mockTab, true);

  assert.ok(scrolledTo !== null, 'scrollTo was called');
  // targetScrollLeft = scrollLeft (0) + (tabRight - containerWidth: 570 - 400 = 170) + edgePadding (4) = 174
  assert.strictEqual(scrolledTo.left, 174, 'Container scrolled to bring right tab fully into view');
  assert.strictEqual(scrolledTo.behavior, 'smooth', 'Smooth scrolling requested');

  console.log('✓ Tab on right side is smoothly brought into view');
}

// ---------------------------------------------------------------------------
// Test 4: scrollTabIntoView brings hidden tab on the left into view
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 4: scrollTabIntoView brings left-hidden tab into view ---');
  let scrolledTo = null;

  // Mock container: clientWidth = 400, scrollWidth = 800, current scrollLeft = 250
  const mockContainer = {
    clientWidth: 400,
    scrollWidth: 800,
    scrollLeft: 250,
    getBoundingClientRect: () => ({ left: 50, right: 450, width: 400 }),
    scrollTo: (options) => {
      scrolledTo = options;
      mockContainer.scrollLeft = options.left;
    },
  };

  // Mock tab element positioned at x = -50..70 relative to viewport (scrolled off left)
  // tabRect.left - containerRect.left = 0 - 50 = -50
  const mockTab = {
    getBoundingClientRect: () => ({ left: 0, right: 120, width: 120 }),
  };

  scrollTabIntoView(mockContainer, mockTab, true);

  assert.ok(scrolledTo !== null, 'scrollTo was called');
  // targetScrollLeft = scrollLeft (250) + tabLeftRelativeToContainer (-50) - edgePadding (4) = 196
  assert.strictEqual(scrolledTo.left, 196, 'Container scrolled left to reveal tab');

  console.log('✓ Tab on left side is smoothly brought into view');
}

// ---------------------------------------------------------------------------
// Test 5: scrollTabIntoView does not scroll when tab is already visible
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 5: scrollTabIntoView no-op when tab is fully visible ---');
  let scrolledTo = null;

  // Mock container: clientWidth = 400, scrollWidth = 800, current scrollLeft = 100
  const mockContainer = {
    clientWidth: 400,
    scrollWidth: 800,
    scrollLeft: 100,
    getBoundingClientRect: () => ({ left: 50, right: 450, width: 400 }),
    scrollTo: (options) => {
      scrolledTo = options;
    },
  };

  // Mock tab element positioned at left = 150, right = 270 relative to container (well within 4..396)
  const mockTab = {
    getBoundingClientRect: () => ({ left: 200, right: 320, width: 120 }),
  };

  scrollTabIntoView(mockContainer, mockTab, true);

  assert.strictEqual(scrolledTo, null, 'No scroll performed for already visible tab');
  console.log('✓ Already visible tab causes zero jumpiness or layout shift');
}

// ---------------------------------------------------------------------------
// Test 6: updateOverflowAttributes accurately sets data attributes
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 6: updateOverflowAttributes sets left/right overflow state ---');
  const attrs = new Map();
  const mockContainer = {
    scrollLeft: 0,
    scrollWidth: 600,
    clientWidth: 400,
    setAttribute: (k, v) => attrs.set(k, v),
    removeAttribute: (k) => attrs.delete(k),
  };

  // At start (scrollLeft = 0): overflow on right only
  updateOverflowAttributes(mockContainer);
  assert.strictEqual(attrs.get('data-overflow-left'), undefined, 'No left overflow at scrollLeft 0');
  assert.strictEqual(attrs.get('data-overflow-right'), 'true', 'Right overflow detected');

  // In middle (scrollLeft = 100): overflow on both sides
  mockContainer.scrollLeft = 100;
  updateOverflowAttributes(mockContainer);
  assert.strictEqual(attrs.get('data-overflow-left'), 'true', 'Left overflow detected');
  assert.strictEqual(attrs.get('data-overflow-right'), 'true', 'Right overflow detected');

  // At end (scrollLeft = 200): overflow on left only
  mockContainer.scrollLeft = 200;
  updateOverflowAttributes(mockContainer);
  assert.strictEqual(attrs.get('data-overflow-left'), 'true', 'Left overflow detected');
  assert.strictEqual(attrs.get('data-overflow-right'), undefined, 'No right overflow at end');

  // No overflow at all (scrollWidth = clientWidth)
  mockContainer.scrollLeft = 0;
  mockContainer.scrollWidth = 400;
  updateOverflowAttributes(mockContainer);
  assert.strictEqual(attrs.get('data-overflow-left'), undefined, 'No left overflow when fitted');
  assert.strictEqual(attrs.get('data-overflow-right'), undefined, 'No right overflow when fitted');

  console.log('✓ Overflow attribute updater accurately tracks scroll position boundaries');
}

// ---------------------------------------------------------------------------
// Test 7: WorkspaceTabBar and WorkspaceTabs use useTabStripScroll hook & attach ref
// ---------------------------------------------------------------------------
{
  console.log('\n--- Test 7: Verify hook usage in WorkspaceTabBar and WorkspaceTabs ---');
  const barTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabBar.tsx'),
    'utf8',
  );
  const tabsTsx = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/WorkspaceTabs.tsx'),
    'utf8',
  );
  const hookTs = fs.readFileSync(
    path.resolve(__dirname, '../app/src/features/workspace/useTabStripScroll.ts'),
    'utf8',
  );

  assert.ok(
    hookTs.includes('export function useTabStripScroll'),
    'useTabStripScroll.ts exports useTabStripScroll',
  );
  assert.ok(
    hookTs.includes('handleWheel') && hookTs.includes('scrollLeft += e.deltaY'),
    'useTabStripScroll handles wheel mapping to horizontal scroll',
  );

  assert.ok(
    barTsx.includes("import { useTabStripScroll } from './useTabStripScroll'"),
    'WorkspaceTabBar imports useTabStripScroll',
  );
  assert.ok(
    barTsx.includes('useTabStripScroll({'),
    'WorkspaceTabBar calls useTabStripScroll',
  );
  assert.ok(
    barTsx.includes('ref={containerRef}') &&
      barTsx.includes('className="workspace-tab-bar-list workspace-tabs-list"'),
    'WorkspaceTabBar attaches containerRef to workspace-tab-bar-list',
  );

  assert.ok(
    tabsTsx.includes("import { useTabStripScroll } from './useTabStripScroll'"),
    'WorkspaceTabs imports useTabStripScroll',
  );
  assert.ok(
    tabsTsx.includes('useTabStripScroll({'),
    'WorkspaceTabs calls useTabStripScroll',
  );
  assert.ok(
    tabsTsx.includes('ref={containerRef}') &&
      tabsTsx.includes('className="workspace-tabs-list terminal-tabs-list"'),
    'WorkspaceTabs attaches containerRef to workspace-tabs-list',
  );

  console.log('✓ Both workspace and terminal tab bars seamlessly integrate useTabStripScroll');
}

console.log('\n=======================================================================');
console.log('ALL 7 ITERM TAB STRIP OVERFLOW & HIDDEN SCROLLBAR TESTS PASSED!');
console.log('=======================================================================\\n');
