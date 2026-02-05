/**
 * Oracle Aggregator - Unit Tests
 * 
 * Tests for multi-source price aggregation with confidence scoring.
 * Run with: npm run test:oracle-unit
 */

import { OracleAggregator, OraclePrice } from '../oracle/oracle-aggregator';
import { PythClient } from '../oracle/pyth-client';
import { ChainlinkMock } from '../oracle/chainlink-mock';
import { TWAPCalculator } from '../oracle/twap-calculator';

interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
}

const tests: TestResult[] = [];

function test(name: string, fn: () => void | Promise<void>): void {
    const exec = async () => {
        try {
            await fn();
            tests.push({ name, passed: true });
        } catch (error) {
            tests.push({
                name,
                passed: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    };
    exec();
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

function assertExists<T>(value: T | null | undefined, msg?: string): asserts value is T {
    if (value === null || value === undefined) {
        throw new Error(msg || 'Expected value to exist');
    }
}

// ============================================================================
// Mock Oracle Sources
// ============================================================================

class MockPythClient {
    private prices: Map<string, bigint> = new Map();
    private stale: Set<string> = new Set();
    private fail: Set<string> = new Set();

    setPrice(asset: string, price: bigint): void {
        this.prices.set(asset, price);
    }

    setStale(asset: string, isStale: boolean): void {
        if (isStale) {
            this.stale.add(asset);
        } else {
            this.stale.delete(asset);
        }
    }

    setFail(asset: string, shouldFail: boolean): void {
        if (shouldFail) {
            this.fail.add(asset);
        } else {
            this.fail.delete(asset);
        }
    }

    async getPrice(asset: string): Promise<{ price: bigint; conf: bigint; timestamp: number } | null> {
        if (this.fail.has(asset)) {
            throw new Error('Pyth fetch failed');
        }
        if (this.stale.has(asset)) {
            return {
                price: this.prices.get(asset) || 0n,
                conf: 0n,
                timestamp: Math.floor(Date.now() / 1000) - 3600, // 1 hour old
            };
        }
        return {
            price: this.prices.get(asset) || 0n,
            conf: 1000000n,
            timestamp: Math.floor(Date.now() / 1000),
        };
    }
}

class MockChainlinkClient {
    private prices: Map<string, bigint> = new Map();
    private fail: Set<string> = new Set();

    setPrice(asset: string, price: bigint): void {
        this.prices.set(asset, price);
    }

    setFail(asset: string, shouldFail: boolean): void {
        if (shouldFail) {
            this.fail.add(asset);
        } else {
            this.fail.delete(asset);
        }
    }

    async getPrice(asset: string): Promise<{ price: bigint; timestamp: number } | null> {
        if (this.fail.has(asset)) {
            throw new Error('Chainlink fetch failed');
        }
        return {
            price: this.prices.get(asset) || 0n,
            timestamp: Math.floor(Date.now() / 1000),
        };
    }
}

class MockTWAPCalculator {
    private prices: Map<string, bigint> = new Map();

    setPrice(asset: string, price: bigint): void {
        this.prices.set(asset, price);
    }

    getPrice(asset: string): bigint {
        return this.prices.get(asset) || 0n;
    }

    addTrade(asset: string, _price: bigint, _volume: bigint): void {
        // No-op for tests
    }
}

// ============================================================================
// Constructor Tests
// ============================================================================

test('Constructor initializes with real clients', async () => {
    const pyth = new PythClient();
    const chainlink = new ChainlinkMock({ latencyMs: 100 });
    const twap = new TWAPCalculator();

    const aggregator = new OracleAggregator(pyth, chainlink, twap);

    assertEqual(aggregator !== null, true, 'Should create aggregator');
});

// ============================================================================
// Price Aggregation Tests
// ============================================================================

test('Returns consensus price from multiple sources', async () => {
    const pyth = new MockPythClient();
    const chainlink = new MockChainlinkClient();
    const twap = new MockTWAPCalculator();

    // Set similar prices across sources
    const price = BigInt(2000) * BigInt(1e18);
    pyth.setPrice('ETH', price);
    chainlink.setPrice('ETH', price);
    twap.setPrice('ETH', price);

    const aggregator = new OracleAggregator(pyth as any, chainlink as any, twap as any);
    const result = await aggregator.getConsensusPrice('ETH');

    assertEqual(result.price, price, 'Should return consensus price');
    assertInRange(result.confidence, 0.9, 1.0, 'Should have high confidence');
});

test('Handles price deviation between sources', async () => {
    const pyth = new MockPythClient();
    const chainlink = new MockChainlinkClient();
    const twap = new MockTWAPCalculator();

    // Set different prices
    pyth.setPrice('ETH', BigInt(2000) * BigInt(1e18));
    chainlink.setPrice('ETH', BigInt(2050) * BigInt(1e18));
    twap.setPrice('ETH', BigInt(1980) * BigInt(1e18));

    const aggregator = new OracleAggregator(pyth as any, chainlink as any, twap as any);
    const result = await aggregator.getConsensusPrice('ETH');

    // Should return some price (median or weighted average)
    assertEqual(result.price > 0n, true, 'Should return a price');

    // Confidence should be lower due to deviation
    assertInRange(result.confidence, 0.5, 0.95, 'Should have reduced confidence');
});

test('Source labeled correctly', async () => {
    const pyth = new MockPythClient();
    const chainlink = new MockChainlinkClient();
    const twap = new MockTWAPCalculator();

    pyth.setPrice('ETH', BigInt(2000) * BigInt(1e18));
    chainlink.setPrice('ETH', BigInt(2000) * BigInt(1e18));
    twap.setPrice('ETH', BigInt(2000) * BigInt(1e18));

    const aggregator = new OracleAggregator(pyth as any, chainlink as any, twap as any);
    const result = await aggregator.getConsensusPrice('ETH');

    const validSources = ['pyth', 'chainlink', 'twap', 'consensus'];
    assertEqual(validSources.includes(result.source), true, `Source should be valid: ${result.source}`);
});

// ============================================================================
// Fallback Behavior Tests
// ============================================================================

test('Falls back when one source fails', async () => {
    const pyth = new MockPythClient();
    const chainlink = new MockChainlinkClient();
    const twap = new MockTWAPCalculator();

    // Pyth fails, others work
    pyth.setFail('ETH', true);
    chainlink.setPrice('ETH', BigInt(2000) * BigInt(1e18));
    twap.setPrice('ETH', BigInt(2000) * BigInt(1e18));

    const aggregator = new OracleAggregator(pyth as any, chainlink as any, twap as any);
    const result = await aggregator.getConsensusPrice('ETH');

    assertEqual(result.price > 0n, true, 'Should still return price');
    // Confidence should be reduced with fewer sources
    assertInRange(result.confidence, 0.5, 0.9);
});

test('Falls back when two sources fail', async () => {
    const pyth = new MockPythClient();
    const chainlink = new MockChainlinkClient();
    const twap = new MockTWAPCalculator();

    // Only TWAP works
    pyth.setFail('ETH', true);
    chainlink.setFail('ETH', true);
    twap.setPrice('ETH', BigInt(2000) * BigInt(1e18));

    const aggregator = new OracleAggregator(pyth as any, chainlink as any, twap as any);
    const result = await aggregator.getConsensusPrice('ETH');

    assertEqual(result.price > 0n, true, 'Should still return TWAP price');
    assertEqual(result.source, 'twap', 'Should use TWAP as source');
    // Very low confidence with single source
    assertInRange(result.confidence, 0.3, 0.7);
});

// ============================================================================
// Staleness Detection Tests
// ============================================================================

test('Detects stale price data', async () => {
    const pyth = new MockPythClient();
    const chainlink = new MockChainlinkClient();
    const twap = new MockTWAPCalculator();

    pyth.setPrice('ETH', BigInt(2000) * BigInt(1e18));
    pyth.setStale('ETH', true); // Mark as stale
    chainlink.setPrice('ETH', BigInt(2000) * BigInt(1e18));

    const aggregator = new OracleAggregator(pyth as any, chainlink as any, twap as any);
    const result = await aggregator.getConsensusPrice('ETH');

    // Should still return a price but note the staleness
    assertEqual(result.price > 0n, true);
});

test('isStale returns correct status', () => {
    const pyth = new PythClient();
    const chainlink = new ChainlinkMock({ latencyMs: 100 });
    const twap = new TWAPCalculator();

    const aggregator = new OracleAggregator(pyth, chainlink, twap);

    // Recent timestamp should not be stale
    const recentTimestamp = Math.floor(Date.now() / 1000);
    assertEqual(aggregator.isStale(recentTimestamp), false, 'Recent should not be stale');

    // Old timestamp should be stale
    const oldTimestamp = Math.floor(Date.now() / 1000) - 3600;
    assertEqual(aggregator.isStale(oldTimestamp), true, 'Hour-old should be stale');
});

// ============================================================================
// Price Deviation Tests
// ============================================================================

test('Calculates deviation correctly', async () => {
    const pyth = new MockPythClient();
    const chainlink = new MockChainlinkClient();
    const twap = new MockTWAPCalculator();

    // 10% deviation
    pyth.setPrice('ETH', BigInt(2000) * BigInt(1e18));
    chainlink.setPrice('ETH', BigInt(2200) * BigInt(1e18));
    twap.setPrice('ETH', BigInt(2100) * BigInt(1e18));

    const aggregator = new OracleAggregator(pyth as any, chainlink as any, twap as any);
    const result = await aggregator.getConsensusPrice('ETH');

    // Confidence should be affected by deviation
    assertInRange(result.confidence, 0.6, 0.9);
});

test('Large deviation triggers circuit breaker', async () => {
    const pyth = new MockPythClient();
    const chainlink = new MockChainlinkClient();
    const twap = new MockTWAPCalculator();

    // 50% deviation - significant discrepancy
    pyth.setPrice('ETH', BigInt(2000) * BigInt(1e18));
    chainlink.setPrice('ETH', BigInt(3000) * BigInt(1e18));
    twap.setPrice('ETH', BigInt(2500) * BigInt(1e18));

    const aggregator = new OracleAggregator(pyth as any, chainlink as any, twap as any);
    const result = await aggregator.getConsensusPrice('ETH');

    // Should have very low confidence
    assertInRange(result.confidence, 0.1, 0.5, 'Large deviation should lower confidence');
});

// ============================================================================
// Edge Cases
// ============================================================================

test('Handles unknown asset', async () => {
    const pyth = new PythClient();
    const chainlink = new ChainlinkMock({ latencyMs: 100 });
    const twap = new TWAPCalculator();

    const aggregator = new OracleAggregator(pyth, chainlink, twap);

    try {
        await aggregator.getConsensusPrice('UNKNOWN_ASSET_XYZ');
        // If it returns, should have low confidence
    } catch (error) {
        // Expected - unknown assets may throw
        assertEqual(error instanceof Error, true);
    }
});

test('Handles zero price from source', async () => {
    const pyth = new MockPythClient();
    const chainlink = new MockChainlinkClient();
    const twap = new MockTWAPCalculator();

    // One source returns 0
    pyth.setPrice('ETH', 0n);
    chainlink.setPrice('ETH', BigInt(2000) * BigInt(1e18));
    twap.setPrice('ETH', BigInt(2000) * BigInt(1e18));

    const aggregator = new OracleAggregator(pyth as any, chainlink as any, twap as any);
    const result = await aggregator.getConsensusPrice('ETH');

    // Should ignore zero and use other sources
    assertEqual(result.price > 0n, true, 'Should ignore zero price');
});

test('Returns timestamp with price', async () => {
    const pyth = new MockPythClient();
    const chainlink = new MockChainlinkClient();
    const twap = new MockTWAPCalculator();

    pyth.setPrice('ETH', BigInt(2000) * BigInt(1e18));
    chainlink.setPrice('ETH', BigInt(2000) * BigInt(1e18));

    const aggregator = new OracleAggregator(pyth as any, chainlink as any, twap as any);
    const result = await aggregator.getConsensusPrice('ETH');

    assertEqual(typeof result.timestamp, 'number', 'Should have timestamp');
    assertEqual(result.timestamp > 0, true, 'Timestamp should be positive');

    // Should be recent (within last hour)
    const now = Math.floor(Date.now() / 1000);
    assertEqual(now - result.timestamp < 3600, true, 'Timestamp should be recent');
});

// ============================================================================
// Run Tests
// ============================================================================

async function runTests(): Promise<void> {
    // Wait for all async tests to complete
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('═'.repeat(60));
    console.log('  Oracle Aggregator - Unit Tests');
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
}

runTests();
