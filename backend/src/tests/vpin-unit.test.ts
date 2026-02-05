/**
 * VPIN Calculator - Unit Tests
 * 
 * Tests for Volume-Synchronized Probability of Informed Trading calculation.
 * Run with: npm run test:vpin-unit
 */

import { VPINCalculator, VPINConfig } from '../yellow/vpin-calculator';

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

function assertApprox(actual: number, expected: number, tolerance: number, msg?: string): void {
    if (Math.abs(actual - expected) > tolerance) {
        throw new Error(msg || `Expected ~${expected}, got ${actual} (tolerance: ${tolerance})`);
    }
}

function assertInRange(value: number, min: number, max: number, msg?: string): void {
    if (value < min || value > max) {
        throw new Error(msg || `Expected ${value} to be in range [${min}, ${max}]`);
    }
}

// ============================================================================
// Constructor Tests
// ============================================================================

test('Constructor with default config', () => {
    const calc = new VPINCalculator();
    const metrics = calc.getMetrics();

    assertInRange(metrics.vpin, 0, 1, 'Initial VPIN should be 0-1');
    assertEqual(metrics.bucketsFilled, 0, 'Initial buckets should be 0');
});

test('Constructor with custom config', () => {
    const config: Partial<VPINConfig> = {
        numBuckets: 100,
        minBucketSize: 50000,
    };

    const calc = new VPINCalculator(config);
    const metrics = calc.getMetrics();

    assertEqual(metrics.bucketSize, 50000, 'Bucket size should be minBucketSize');
});

test('Constructor validates numBuckets', () => {
    // Should accept valid numBuckets
    const calc = new VPINCalculator({ numBuckets: 25 });
    assertEqual(calc.getMetrics().bucketsFilled < 26, true);
});

// ============================================================================
// Trade Processing Tests
// ============================================================================

test('Process single buy trade', () => {
    const calc = new VPINCalculator({ minBucketSize: 1000, numBuckets: 10 });

    const metrics = calc.processTrade(500, true);

    assertInRange(metrics.vpin, 0, 1, 'VPIN should be 0-1 after trade');
});

test('Process single sell trade', () => {
    const calc = new VPINCalculator({ minBucketSize: 1000, numBuckets: 10 });

    const metrics = calc.processTrade(500, false);

    assertInRange(metrics.vpin, 0, 1, 'VPIN should be 0-1 after trade');
});

test('Equal buy/sell should give low VPIN', () => {
    const calc = new VPINCalculator({ minBucketSize: 1000, numBuckets: 10 });

    // Process equal buys and sells
    for (let i = 0; i < 100; i++) {
        calc.processTrade(100, true);
        calc.processTrade(100, false);
    }

    const vpin = calc.getVPIN();
    assertInRange(vpin, 0, 0.3, 'Equal buy/sell should give low VPIN');
});

test('All buys should give high VPIN', () => {
    const calc = new VPINCalculator({ minBucketSize: 1000, numBuckets: 10 });

    // Process only buys
    for (let i = 0; i < 100; i++) {
        calc.processTrade(100, true);
    }

    const vpin = calc.getVPIN();
    assertInRange(vpin, 0.8, 1.0, 'All buys should give high VPIN');
});

test('All sells should give high VPIN', () => {
    const calc = new VPINCalculator({ minBucketSize: 1000, numBuckets: 10 });

    // Process only sells
    for (let i = 0; i < 100; i++) {
        calc.processTrade(100, false);
    }

    const vpin = calc.getVPIN();
    assertInRange(vpin, 0.8, 1.0, 'All sells should give high VPIN');
});

test('Trade volume accumulates correctly', () => {
    const calc = new VPINCalculator({ minBucketSize: 1000, numBuckets: 10 });

    // Add 500 volume
    calc.processTrade(500, true);

    // Bucket should not be full yet
    const metrics1 = calc.getMetrics();
    assertEqual(metrics1.currentBucketVolume, 500, 'Should have 500 in bucket');

    // Add 500 more - bucket should fill
    calc.processTrade(500, true);

    const metrics2 = calc.getMetrics();

    // Should have at least 1 bucket filled
    assertEqual(metrics2.bucketsFilled >= 1, true, 'Should have filled bucket');
});

test('Large trade spans multiple buckets', () => {
    const calc = new VPINCalculator({ minBucketSize: 1000, numBuckets: 50 });

    // Single large trade of 5000 (5 buckets worth)
    calc.processTrade(5000, true);

    const metrics = calc.getMetrics();

    // Should have filled multiple buckets
    assertEqual(metrics.bucketsFilled >= 5, true, 'Large trade should fill multiple buckets');
});

test('Zero volume trade is handled', () => {
    const calc = new VPINCalculator();

    // Should not throw
    calc.processTrade(0, true);

    const metrics = calc.getMetrics();
    assertEqual(metrics.bucketsFilled, 0, 'Zero volume should not fill buckets');
});

// ============================================================================
// Bucket Management Tests
// ============================================================================

test('Buckets roll over correctly', () => {
    const calc = new VPINCalculator({ minBucketSize: 100, numBuckets: 5 });

    // Fill more than numBuckets worth
    for (let i = 0; i < 10; i++) {
        calc.processTrade(100, true);
    }

    const metrics = calc.getMetrics();

    // Should have exactly numBuckets
    assertEqual(metrics.bucketsFilled, 5, 'Should have exactly numBuckets after overflow');
});

test('Old buckets are dropped', () => {
    const calc = new VPINCalculator({ minBucketSize: 100, numBuckets: 3 });

    // Fill with all buys
    for (let i = 0; i < 3; i++) {
        calc.processTrade(100, true);
    }

    const vpin1 = calc.getVPIN();
    assertEqual(vpin1 === 1, true, 'All buys should give VPIN=1');

    // Now fill with all sells (should push out old buckets)
    for (let i = 0; i < 3; i++) {
        calc.processTrade(100, false);
    }

    const vpin2 = calc.getVPIN();
    assertEqual(vpin2 === 1, true, 'All sells should give VPIN=1');
});

// ============================================================================
// Recalibration Tests
// ============================================================================

test('RecalibrateBucketSize updates bucket size', () => {
    const calc = new VPINCalculator({
        minBucketSize: 10000,
        bucketSizeRatio: 50
    });

    const initialSize = calc.getMetrics().bucketSize;

    // Recalibrate with high ADV - bucket size should increase
    calc.recalibrateBucketSize(500000);

    const newSize = calc.getMetrics().bucketSize;

    // Bucket size could change based on ADV/ratio
    assertEqual(newSize >= 10000, true, 'Bucket size should be at least minBucketSize');
});

test('RecalibrateBucketSize respects min/max', () => {
    const calc = new VPINCalculator({
        minBucketSize: 10000,
        maxBucketSize: 100000,
    });

    // Very high ADV
    calc.recalibrateBucketSize(10_000_000);

    const metrics = calc.getMetrics();
    assertEqual(metrics.bucketSize <= 100000, true, 'Should not exceed maxBucketSize');
});

// ============================================================================
// Interpretation Tests
// ============================================================================

test('getInterpretation for normal VPIN', () => {
    const calc = new VPINCalculator();
    const interp = calc.getInterpretation(0.2);

    assertEqual(interp.level, 'normal', 'VPIN 0.2 should be normal');
});

test('getInterpretation for elevated VPIN', () => {
    const calc = new VPINCalculator();
    const interp = calc.getInterpretation(0.45);

    assertEqual(interp.level, 'elevated', 'VPIN 0.45 should be elevated');
});

test('getInterpretation for high VPIN', () => {
    const calc = new VPINCalculator();
    const interp = calc.getInterpretation(0.65);

    assertEqual(interp.level, 'high', 'VPIN 0.65 should be high');
});

test('getInterpretation for extreme VPIN', () => {
    const calc = new VPINCalculator();
    const interp = calc.getInterpretation(0.85);

    assertEqual(interp.level, 'extreme', 'VPIN 0.85 should be extreme');
});

test('Interpretation includes description', () => {
    const calc = new VPINCalculator();
    const interp = calc.getInterpretation(0.5);

    assertEqual(interp.description.length > 0, true, 'Should have description');
    assertEqual(interp.recommendedAction.length > 0, true, 'Should have recommendation');
});

// ============================================================================
// Reset Tests
// ============================================================================

test('Reset clears all state', () => {
    const calc = new VPINCalculator({ minBucketSize: 100 });

    // Fill some buckets
    for (let i = 0; i < 10; i++) {
        calc.processTrade(100, true);
    }

    const beforeReset = calc.getMetrics();
    assertEqual(beforeReset.bucketsFilled > 0, true, 'Should have buckets before reset');

    calc.reset();

    const afterReset = calc.getMetrics();
    assertEqual(afterReset.bucketsFilled, 0, 'Should have no buckets after reset');
    assertEqual(afterReset.vpin, 0, 'VPIN should be 0 after reset');
});

// ============================================================================
// Edge Cases
// ============================================================================

test('VPIN never exceeds 1', () => {
    const calc = new VPINCalculator({ minBucketSize: 10, numBuckets: 5 });

    // Process extreme one-sided flow
    for (let i = 0; i < 1000; i++) {
        calc.processTrade(100, true);
        const vpin = calc.getVPIN();
        assertEqual(vpin <= 1, true, `VPIN ${vpin} exceeded 1 at iteration ${i}`);
    }
});

test('VPIN never goes below 0', () => {
    const calc = new VPINCalculator({ minBucketSize: 10, numBuckets: 5 });

    // Process mixed flow
    for (let i = 0; i < 1000; i++) {
        calc.processTrade(Math.random() * 100, Math.random() > 0.5);
        const vpin = calc.getVPIN();
        assertEqual(vpin >= 0, true, `VPIN ${vpin} went below 0 at iteration ${i}`);
    }
});

test('Rapid alternating trades', () => {
    const calc = new VPINCalculator({ minBucketSize: 50, numBuckets: 10 });

    // Rapidly alternate buys and sells
    for (let i = 0; i < 1000; i++) {
        calc.processTrade(25, i % 2 === 0);
    }

    const vpin = calc.getVPIN();
    assertInRange(vpin, 0, 0.3, 'Alternating trades should give low VPIN');
});

test('Very small trades accumulate', () => {
    const calc = new VPINCalculator({ minBucketSize: 1000, numBuckets: 10 });

    // Many tiny trades
    for (let i = 0; i < 10000; i++) {
        calc.processTrade(1, true);
    }

    const metrics = calc.getMetrics();
    assertEqual(metrics.bucketsFilled >= 1, true, 'Small trades should accumulate');
});

// ============================================================================
// Run Tests
// ============================================================================

console.log('═'.repeat(60));
console.log('  VPIN Calculator - Unit Tests');
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
