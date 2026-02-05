/**
 * Regime Detector - Unit Tests
 * 
 * Tests for NYSE market regime detection including timezone handling.
 * Run with: npm run test:regime-unit
 */

import { RegimeDetector, Regime, RegimeInfo } from '../yellow/regime-detector';

interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
}

const tests: TestResult[] = [];

function test(name: string, fn: () => void): void {
    try {
        fn();
        tests.push({ name, passed: true });
    } catch (error) {
        tests.push({
            name,
            passed: false,
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

function assertEqual<T>(actual: T, expected: T, msg?: string): void {
    if (actual !== expected) {
        throw new Error(msg || `Expected ${expected}, got ${actual}`);
    }
}

function assertInRange(value: number, min: number, max: number, msg?: string): void {
    if (value < min || value > max) {
        throw new Error(msg || `Expected ${value} to be in range [${min}, ${max}]`);
    }
}

function assertIncludes<T>(arr: T[], item: T, msg?: string): void {
    if (!arr.includes(item)) {
        throw new Error(msg || `Expected array to include ${item}`);
    }
}

// ============================================================================
// Helper to create specific timestamps
// ============================================================================

function createETTimestamp(
    year: number,
    month: number,  // 1-12
    day: number,
    hour: number,   // 0-23 in ET
    minute: number = 0
): number {
    // ET is UTC-5 (EST) or UTC-4 (EDT)
    // For testing, assume EST (UTC-5)
    const utcHour = (hour + 5) % 24;
    const dayOffset = hour + 5 >= 24 ? 1 : 0;
    const date = new Date(Date.UTC(year, month - 1, day + dayOffset, utcHour, minute));
    return date.getTime();
}

// ============================================================================
// Constructor Tests
// ============================================================================

test('Constructor with default config', () => {
    const detector = new RegimeDetector();
    const info = detector.getCurrentRegime();

    // Should return valid regime info
    assertEqual(info !== null, true, 'Should return regime info');
    assertInRange(info.multiplier, 1, 10, 'Multiplier should be 1-10');
});

test('Constructor with custom holidays', () => {
    const detector = new RegimeDetector({
        holidays: ['2026-12-31']
    });
    const info = detector.getCurrentRegime();

    assertEqual(info !== null, true, 'Should work with custom config');
});

// ============================================================================
// Core Session Tests
// ============================================================================

test('Core session at 10:30 AM ET Monday', () => {
    const detector = new RegimeDetector();
    // Monday Feb 9, 2026 at 10:30 AM ET = 15:30 UTC
    const timestamp = new Date('2026-02-09T15:30:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.CORE_SESSION, 'Should be CORE_SESSION');
    assertEqual(info.multiplier, 1.0, 'Multiplier should be 1.0');
});

test('Core session at 2:00 PM ET Tuesday', () => {
    const detector = new RegimeDetector();
    // Tuesday Feb 10, 2026 at 2:00 PM ET = 19:00 UTC
    const timestamp = new Date('2026-02-10T19:00:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.CORE_SESSION, 'Should be CORE_SESSION');
});

test('Core session multiplier is lowest', () => {
    const detector = new RegimeDetector();
    // Monday at noon ET
    const timestamp = new Date('2026-02-09T17:00:00Z').getTime();
    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.multiplier, 1.0, 'Core session should have 1.0 multiplier');
    assertEqual(info.riskLevel, 'low', 'Core session should be low risk');
});

// ============================================================================
// Soft Open Tests
// ============================================================================

test('Soft open at 9:30 AM ET', () => {
    const detector = new RegimeDetector();
    // 9:30 AM ET = 14:30 UTC
    const timestamp = new Date('2026-02-09T14:30:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.SOFT_OPEN, 'Should be SOFT_OPEN at 9:30');
});

test('Soft open at 9:33 AM ET', () => {
    const detector = new RegimeDetector();
    // 9:33 AM ET = 14:33 UTC
    const timestamp = new Date('2026-02-09T14:33:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.SOFT_OPEN, 'Should be SOFT_OPEN at 9:33');
});

test('Core session starts at 9:35 AM ET', () => {
    const detector = new RegimeDetector();
    // 9:35 AM ET = 14:35 UTC
    const timestamp = new Date('2026-02-09T14:35:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.CORE_SESSION, 'Should be CORE_SESSION at 9:35');
});

test('Soft open has higher multiplier than core', () => {
    const detector = new RegimeDetector();
    const softOpen = detector.getCurrentRegime(new Date('2026-02-09T14:30:00Z').getTime());
    const core = detector.getCurrentRegime(new Date('2026-02-09T16:00:00Z').getTime());

    assertEqual(softOpen.multiplier > core.multiplier, true, 'Soft open should have higher multiplier');
});

// ============================================================================
// Pre-Market Tests
// ============================================================================

test('Pre-market at 8:00 AM ET', () => {
    const detector = new RegimeDetector();
    // 8:00 AM ET = 13:00 UTC
    const timestamp = new Date('2026-02-09T13:00:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.PRE_MARKET, 'Should be PRE_MARKET at 8:00 AM ET');
});

test('Pre-market at 4:30 AM ET', () => {
    const detector = new RegimeDetector();
    // 4:30 AM ET = 9:30 UTC
    const timestamp = new Date('2026-02-09T09:30:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.PRE_MARKET, 'Should be PRE_MARKET at 4:30 AM ET');
});

test('Pre-market ends at 9:30 AM ET', () => {
    const detector = new RegimeDetector();

    // 9:29 AM ET = 14:29 UTC
    const before = detector.getCurrentRegime(new Date('2026-02-09T14:29:00Z').getTime());
    // 9:30 AM ET = 14:30 UTC
    const at = detector.getCurrentRegime(new Date('2026-02-09T14:30:00Z').getTime());

    assertEqual(before.regime, Regime.PRE_MARKET, 'Should be PRE_MARKET before 9:30');
    assertEqual(at.regime, Regime.SOFT_OPEN, 'Should be SOFT_OPEN at 9:30');
});

// ============================================================================
// After Hours Tests
// ============================================================================

test('After hours at 4:30 PM ET', () => {
    const detector = new RegimeDetector();
    // 4:30 PM ET = 21:30 UTC
    const timestamp = new Date('2026-02-09T21:30:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.AFTER_HOURS, 'Should be AFTER_HOURS at 4:30 PM');
});

test('After hours at 7:00 PM ET', () => {
    const detector = new RegimeDetector();
    // 7:00 PM ET = 00:00 UTC next day
    const timestamp = new Date('2026-02-10T00:00:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.AFTER_HOURS, 'Should be AFTER_HOURS at 7:00 PM');
});

test('After hours starts at 4:00 PM ET', () => {
    const detector = new RegimeDetector();

    // 3:59 PM ET = 20:59 UTC
    const before = detector.getCurrentRegime(new Date('2026-02-09T20:59:00Z').getTime());
    // 4:00 PM ET = 21:00 UTC
    const at = detector.getCurrentRegime(new Date('2026-02-09T21:00:00Z').getTime());

    assertEqual(before.regime, Regime.CORE_SESSION, 'Should be CORE_SESSION before 4:00');
    assertEqual(at.regime, Regime.AFTER_HOURS, 'Should be AFTER_HOURS at 4:00');
});

// ============================================================================
// Overnight Tests
// ============================================================================

test('Overnight at 9:00 PM ET', () => {
    const detector = new RegimeDetector();
    // 9:00 PM ET = 02:00 UTC next day
    const timestamp = new Date('2026-02-10T02:00:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.OVERNIGHT, 'Should be OVERNIGHT at 9:00 PM');
});

test('Overnight at 2:00 AM ET', () => {
    const detector = new RegimeDetector();
    // 2:00 AM ET = 07:00 UTC
    const timestamp = new Date('2026-02-10T07:00:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.OVERNIGHT, 'Should be OVERNIGHT at 2:00 AM');
});

test('Overnight has higher multiplier than core', () => {
    const detector = new RegimeDetector();
    const overnight = detector.getCurrentRegime(new Date('2026-02-10T07:00:00Z').getTime());
    const core = detector.getCurrentRegime(new Date('2026-02-09T17:00:00Z').getTime());

    assertEqual(overnight.multiplier > core.multiplier, true, 'Overnight should have higher multiplier');
});

// ============================================================================
// Weekend Tests
// ============================================================================

test('Weekend on Saturday', () => {
    const detector = new RegimeDetector();
    // Saturday Feb 7, 2026 at noon ET = 17:00 UTC
    const timestamp = new Date('2026-02-07T17:00:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.WEEKEND, 'Should be WEEKEND on Saturday');
});

test('Weekend on Sunday', () => {
    const detector = new RegimeDetector();
    // Sunday Feb 8, 2026 at noon ET = 17:00 UTC
    const timestamp = new Date('2026-02-08T17:00:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.WEEKEND, 'Should be WEEKEND on Sunday');
});

test('Weekend has high multiplier', () => {
    const detector = new RegimeDetector();
    const weekend = detector.getCurrentRegime(new Date('2026-02-07T17:00:00Z').getTime());

    assertEqual(weekend.multiplier >= 2.0, true, 'Weekend should have >= 2.0 multiplier');
});

// ============================================================================
// Holiday Tests
// ============================================================================

test('New Years Day is a holiday', () => {
    const detector = new RegimeDetector();
    // Jan 1, 2026 at noon ET = 17:00 UTC
    const timestamp = new Date('2026-01-01T17:00:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.HOLIDAY, 'Should be HOLIDAY on New Years Day');
});

test('Holiday has high multiplier', () => {
    const detector = new RegimeDetector();
    // MLK Day 2026
    const timestamp = new Date('2026-01-19T17:00:00Z').getTime();

    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.multiplier >= 2.0, true, 'Holiday should have high multiplier');
});

test('Can add custom holidays', () => {
    const detector = new RegimeDetector();

    // Add a custom holiday
    detector.addHoliday('2026-03-15');

    // Check that it's detected
    const timestamp = new Date('2026-03-15T17:00:00Z').getTime();
    const info = detector.getCurrentRegime(timestamp);

    assertEqual(info.regime, Regime.HOLIDAY, 'Custom holiday should be detected');
});

// ============================================================================
// Time Until Next Regime Tests
// ============================================================================

test('getTimeUntilNextRegime returns valid data', () => {
    const detector = new RegimeDetector();
    const next = detector.getTimeUntilNextRegime();

    assertEqual(next !== null, true, 'Should return next regime info');
    assertEqual(typeof next.secondsUntil, 'number', 'Should have secondsUntil');
    assertEqual(next.secondsUntil >= 0, true, 'secondsUntil should be non-negative');
});

test('getTimeUntilNextRegime during pre-market', () => {
    const detector = new RegimeDetector();
    // 9:00 AM ET = 14:00 UTC - should be 30 min until SOFT_OPEN
    const timestamp = new Date('2026-02-09T14:00:00Z').getTime();

    const next = detector.getTimeUntilNextRegime(timestamp);

    assertEqual(next.nextRegime, Regime.SOFT_OPEN, 'Next regime should be SOFT_OPEN');
    // Should be around 30 minutes (1800 seconds)
    assertInRange(next.secondsUntil, 1700, 1900, 'Should be ~30 minutes until soft open');
});

test('Next regime is reasonable time away', () => {
    const detector = new RegimeDetector();
    const next = detector.getTimeUntilNextRegime();

    // Should never be more than 24 hours away for normal weekdays
    assertInRange(next.secondsUntil, 0, 86400, 'Should be < 24 hours away');
});

// ============================================================================
// Multiplier and Fee Tests
// ============================================================================

test('All regimes have valid parameters', () => {
    const detector = new RegimeDetector();

    // Test known timestamps for each regime
    const testCases = [
        { timestamp: new Date('2026-02-09T17:00:00Z').getTime(), regime: Regime.CORE_SESSION },
        { timestamp: new Date('2026-02-09T14:30:00Z').getTime(), regime: Regime.SOFT_OPEN },
        { timestamp: new Date('2026-02-09T13:00:00Z').getTime(), regime: Regime.PRE_MARKET },
        { timestamp: new Date('2026-02-09T21:30:00Z').getTime(), regime: Regime.AFTER_HOURS },
        { timestamp: new Date('2026-02-10T07:00:00Z').getTime(), regime: Regime.OVERNIGHT },
        { timestamp: new Date('2026-02-07T17:00:00Z').getTime(), regime: Regime.WEEKEND },
        { timestamp: new Date('2026-01-01T17:00:00Z').getTime(), regime: Regime.HOLIDAY },
    ];

    for (const tc of testCases) {
        const info = detector.getCurrentRegime(tc.timestamp);
        assertEqual(info.regime, tc.regime, `Expected ${tc.regime}`);
        assertInRange(info.multiplier, 1, 10, `${tc.regime} multiplier should be 1-10`);
        assertEqual(info.baseFee > 0, true, `${tc.regime} should have positive baseFee`);
        assertEqual(info.maxFee > info.baseFee, true, `${tc.regime} maxFee should exceed baseFee`);
    }
});

test('Regime risk levels are valid', () => {
    const detector = new RegimeDetector();

    const coreInfo = detector.getCurrentRegime(new Date('2026-02-09T17:00:00Z').getTime());
    const validLevels = ['low', 'medium', 'high', 'very-high', 'extreme'];

    assertIncludes(validLevels, coreInfo.riskLevel, 'Should have valid risk level');
});

// ============================================================================
// Edge Cases
// ============================================================================

test('Handles future timestamps', () => {
    const detector = new RegimeDetector();
    const future = Date.now() + 365 * 24 * 60 * 60 * 1000; // 1 year from now

    const info = detector.getCurrentRegime(future);

    assertEqual(info !== null, true, 'Should handle future timestamps');
    assertInRange(info.multiplier, 1, 10);
});

test('Handles past timestamps', () => {
    const detector = new RegimeDetector();
    const past = Date.now() - 365 * 24 * 60 * 60 * 1000; // 1 year ago

    const info = detector.getCurrentRegime(past);

    assertEqual(info !== null, true, 'Should handle past timestamps');
});

test('isHoliday correctly identifies holidays', () => {
    const detector = new RegimeDetector();

    // NY Day 2026
    const nyDay = new Date('2026-01-01');
    assertEqual(detector.isHoliday(nyDay), true, 'NY Day should be holiday');

    // Random day
    const randomDay = new Date('2026-03-10');
    assertEqual(detector.isHoliday(randomDay), false, 'Random day should not be holiday');
});

// ============================================================================
// Run Tests
// ============================================================================

console.log('═'.repeat(60));
console.log('  Regime Detector - Unit Tests');
console.log('═'.repeat(60) + '\n');

const passed = tests.filter(t => t.passed).length;
const failed = tests.filter(t => !t.passed).length;

for (const t of tests) {
    const icon = t.passed ? '✅' : '❌';
    console.log(`${icon} ${t.name}`);
    if (!t.passed && t.error) {
        console.log(`   └─ ${t.error}`);
    }
}

console.log(`\n${'═'.repeat(60)}`);
console.log(`  Results: ${passed}/${tests.length} passed`);
console.log('═'.repeat(60) + '\n');

if (failed > 0) {
    process.exit(1);
}
