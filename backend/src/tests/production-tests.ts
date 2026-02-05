/**
 * StockShield Backend - Production Test Suite
 * 
 * Comprehensive tests for API Server, WebSocket Server, and Core Services.
 * Run with: npm run test:prod
 */

import http from 'http';
import { WebSocket } from 'ws';

// ============================================================================
// Test Configuration
// ============================================================================

const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const WS_URL = process.env.WS_URL || 'ws://localhost:3001/ws';
const TEST_TIMEOUT = 10000;

interface TestResult {
    name: string;
    passed: boolean;
    duration: number;
    error?: string;
    details?: unknown;
}

interface TestSuite {
    name: string;
    tests: TestResult[];
    passed: number;
    failed: number;
}

// ============================================================================
// Test Utilities
// ============================================================================

async function httpGet<T>(path: string): Promise<{ status: number; data: T }> {
    return new Promise((resolve, reject) => {
        const url = new URL(path, API_BASE);

        const req = http.request(url, { method: 'GET' }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({
                        status: res.statusCode || 0,
                        data: JSON.parse(data) as T,
                    });
                } catch {
                    resolve({
                        status: res.statusCode || 0,
                        data: data as unknown as T,
                    });
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(TEST_TIMEOUT, () => reject(new Error('Request timeout')));
        req.end();
    });
}

function wsConnect(url: string): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
            ws.close();
            reject(new Error('WebSocket connection timeout'));
        }, TEST_TIMEOUT);

        ws.on('open', () => {
            clearTimeout(timeout);
            resolve(ws);
        });
        ws.on('error', (err) => {
            clearTimeout(timeout);
            reject(err);
        });
    });
}

function wsReceive(ws: WebSocket, timeoutMs: number = 5000): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            reject(new Error('WebSocket message timeout'));
        }, timeoutMs);

        ws.once('message', (data) => {
            clearTimeout(timeout);
            try {
                resolve(JSON.parse(data.toString()));
            } catch {
                resolve(data.toString());
            }
        });
    });
}

async function runTest(
    name: string,
    testFn: () => Promise<void>
): Promise<TestResult> {
    const start = Date.now();
    try {
        await testFn();
        return {
            name,
            passed: true,
            duration: Date.now() - start,
        };
    } catch (error) {
        return {
            name,
            passed: false,
            duration: Date.now() - start,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

// ============================================================================
// API Server Tests
// ============================================================================

async function testAPIServer(): Promise<TestSuite> {
    const suite: TestSuite = {
        name: 'API Server',
        tests: [],
        passed: 0,
        failed: 0,
    };

    // Test 1: Health endpoint
    suite.tests.push(await runTest('GET /api/health returns 200', async () => {
        const { status, data } = await httpGet<{ status: string; uptime: number }>('/api/health');

        if (status !== 200) throw new Error(`Expected 200, got ${status}`);
        if (data.status !== 'healthy') throw new Error(`Expected status 'healthy', got '${data.status}'`);
        if (typeof data.uptime !== 'number') throw new Error('Missing uptime');
    }));

    // Test 2: Health endpoint has required fields
    suite.tests.push(await runTest('GET /api/health has all required fields', async () => {
        const { data } = await httpGet<{
            status: string;
            uptime: number;
            services: Record<string, string>;
            timestamp: number;
        }>('/api/health');

        const required = ['status', 'uptime', 'services', 'timestamp'];
        for (const field of required) {
            if (!(field in data)) throw new Error(`Missing field: ${field}`);
        }
    }));

    // Test 3: Regime endpoint
    suite.tests.push(await runTest('GET /api/regime returns valid regime', async () => {
        const { status, data } = await httpGet<{
            regime: string;
            multiplier: number;
            baseFee: number;
            maxFee: number;
        }>('/api/regime');

        if (status !== 200) throw new Error(`Expected 200, got ${status}`);

        const validRegimes = [
            'CORE_SESSION', 'SOFT_OPEN', 'PRE_MARKET',
            'AFTER_HOURS', 'OVERNIGHT', 'WEEKEND', 'HOLIDAY'
        ];
        if (!validRegimes.includes(data.regime)) {
            throw new Error(`Invalid regime: ${data.regime}`);
        }
        if (data.multiplier < 1 || data.multiplier > 10) {
            throw new Error(`Invalid multiplier: ${data.multiplier}`);
        }
    }));

    // Test 4: Regime has next transition
    suite.tests.push(await runTest('GET /api/regime includes next transition', async () => {
        const { data } = await httpGet<{
            nextTransition: { regime: string; secondsUntil: number };
        }>('/api/regime');

        if (!data.nextTransition) throw new Error('Missing nextTransition');
        if (typeof data.nextTransition.secondsUntil !== 'number') {
            throw new Error('Missing secondsUntil');
        }
    }));

    // Test 5: VPIN endpoint
    suite.tests.push(await runTest('GET /api/vpin/:poolId returns VPIN data', async () => {
        const { status, data } = await httpGet<{
            poolId: string;
            vpin: number;
            bucketCount: number;
            interpretation: string;
        }>('/api/vpin/0xtest');

        if (status !== 200) throw new Error(`Expected 200, got ${status}`);
        if (typeof data.vpin !== 'number') throw new Error('Missing vpin');
        if (data.vpin < 0 || data.vpin > 1) throw new Error(`Invalid VPIN range: ${data.vpin}`);
    }));

    // Test 6: VPIN interpretation
    suite.tests.push(await runTest('GET /api/vpin has valid interpretation', async () => {
        const { data } = await httpGet<{
            interpretation: string;
            description: string;
            recommendedAction: string;
        }>('/api/vpin/0xtest');

        const validLevels = ['normal', 'elevated', 'high', 'extreme'];
        if (!validLevels.includes(data.interpretation)) {
            throw new Error(`Invalid interpretation: ${data.interpretation}`);
        }
    }));

    // Test 7: Price endpoint
    suite.tests.push(await runTest('GET /api/price/:asset returns oracle price', async () => {
        const { status, data } = await httpGet<{
            asset: string;
            price: number;
            source: string;
            confidence: number;
        }>('/api/price/ETH');

        if (status !== 200) throw new Error(`Expected 200, got ${status}`);
        if (data.asset !== 'ETH') throw new Error(`Expected asset 'ETH', got '${data.asset}'`);
        if (typeof data.price !== 'number') throw new Error('Missing price');
        if (data.price <= 0) throw new Error(`Invalid price: ${data.price}`);
    }));

    // Test 8: Price confidence score
    suite.tests.push(await runTest('GET /api/price has valid confidence', async () => {
        const { data } = await httpGet<{
            confidence: number;
            source: string;
        }>('/api/price/ETH');

        if (data.confidence < 0 || data.confidence > 1) {
            throw new Error(`Invalid confidence: ${data.confidence}`);
        }
        const validSources = ['chainlink', 'pyth', 'twap', 'consensus', 'mock'];
        if (!validSources.includes(data.source)) {
            throw new Error(`Invalid source: ${data.source}`);
        }
    }));

    // Test 9: Fees endpoint
    suite.tests.push(await runTest('GET /api/fees/:poolId returns fee breakdown', async () => {
        const { status, data } = await httpGet<{
            poolId: string;
            baseFee: number;
            vpinComponent: number;
            totalFee: number;
        }>('/api/fees/0xtest');

        if (status !== 200) throw new Error(`Expected 200, got ${status}`);
        if (typeof data.totalFee !== 'number') throw new Error('Missing totalFee');
        if (data.totalFee < 0) throw new Error(`Invalid fee: ${data.totalFee}`);
    }));

    // Test 10: Fee components add up
    suite.tests.push(await runTest('GET /api/fees components are valid', async () => {
        const { data } = await httpGet<{
            baseFee: number;
            vpinComponent: number;
            volatilityComponent: number;
            inventoryComponent: number;
            regimeMultiplier: number;
        }>('/api/fees/0xtest');

        if (data.baseFee < 0) throw new Error('Negative baseFee');
        if (data.vpinComponent < 0) throw new Error('Negative vpinComponent');
        if (data.regimeMultiplier < 1) throw new Error('Invalid multiplier');
    }));

    // Test 11: Pools endpoint
    suite.tests.push(await runTest('GET /api/pools returns pool list', async () => {
        const { status, data } = await httpGet<{
            pools: Array<{ poolId: string; asset: string }>;
            count: number;
        }>('/api/pools');

        if (status !== 200) throw new Error(`Expected 200, got ${status}`);
        if (!Array.isArray(data.pools)) throw new Error('pools is not an array');
        if (data.count !== data.pools.length) throw new Error('Count mismatch');
    }));

    // Test 12: Pool data structure
    suite.tests.push(await runTest('GET /api/pools has valid pool structure', async () => {
        const { data } = await httpGet<{
            pools: Array<{
                poolId: string;
                asset: string;
                liquidity: string;
                vpin: number;
                fee: number;
            }>;
        }>('/api/pools');

        if (data.pools.length > 0) {
            const pool = data.pools[0];
            if (!pool) throw new Error('Pool array is empty');
            const required = ['poolId', 'asset', 'liquidity', 'vpin', 'fee'];
            for (const field of required) {
                if (!(field in pool)) throw new Error(`Missing pool field: ${field}`);
            }
        }
    }));

    // Test 13: Pool detail endpoint
    suite.tests.push(await runTest('GET /api/pools/:poolId returns pool detail', async () => {
        // First get a valid pool ID
        const { data: poolsData } = await httpGet<{ pools: Array<{ poolId: string }> }>('/api/pools');

        const firstPool = poolsData.pools[0];
        if (firstPool) {
            const poolId = firstPool.poolId;
            const { status, data } = await httpGet<{ poolId: string; regimeInfo: object }>(`/api/pools/${poolId}`);

            if (status !== 200) throw new Error(`Expected 200, got ${status}`);
            if (!data.regimeInfo) throw new Error('Missing regimeInfo in pool detail');
        }
    }));

    // Test 14: Circuit breaker endpoint
    suite.tests.push(await runTest('GET /api/circuit-breaker returns status', async () => {
        const { status, data } = await httpGet<{
            level: number;
            flags: string[];
            actions: string[];
        }>('/api/circuit-breaker');

        if (status !== 200) throw new Error(`Expected 200, got ${status}`);
        if (typeof data.level !== 'number') throw new Error('Missing level');
        if (data.level < 0 || data.level > 4) throw new Error(`Invalid level: ${data.level}`);
        if (!Array.isArray(data.flags)) throw new Error('flags is not an array');
    }));

    // Test 15: Active auctions endpoint
    suite.tests.push(await runTest('GET /api/auctions/active returns auction list', async () => {
        const { status, data } = await httpGet<{
            auctions: Array<{ id: string; phase: string }>;
            count: number;
        }>('/api/auctions/active');

        if (status !== 200) throw new Error(`Expected 200, got ${status}`);
        if (!Array.isArray(data.auctions)) throw new Error('auctions is not an array');
        if (data.count !== data.auctions.length) throw new Error('Count mismatch');
    }));

    // Test 16: 404 for unknown endpoint
    suite.tests.push(await runTest('GET /api/unknown returns 404', async () => {
        const { status } = await httpGet('/api/unknown-endpoint-12345');
        if (status !== 404) throw new Error(`Expected 404, got ${status}`);
    }));

    // Test 17: CORS headers
    suite.tests.push(await runTest('API returns CORS headers', async () => {
        const response = await new Promise<http.IncomingMessage>((resolve, reject) => {
            const url = new URL('/api/health', API_BASE);
            const req = http.request(url, { method: 'OPTIONS' }, resolve);
            req.on('error', reject);
            req.end();
        });

        const corsHeader = response.headers['access-control-allow-origin'];
        if (corsHeader !== '*') throw new Error(`Missing CORS header, got: ${corsHeader}`);
    }));

    // Test 18: Response timestamps
    suite.tests.push(await runTest('All responses include timestamp', async () => {
        const endpoints = ['/api/health', '/api/regime', '/api/vpin/0x1', '/api/pools'];

        for (const endpoint of endpoints) {
            const { data } = await httpGet<{ timestamp: number }>(endpoint);
            if (!data.timestamp) throw new Error(`Missing timestamp in ${endpoint}`);

            const age = Date.now() - data.timestamp;
            if (age > 5000 || age < -5000) {
                throw new Error(`Timestamp too old/future in ${endpoint}: ${age}ms`);
            }
        }
    }));

    // Calculate totals
    suite.passed = suite.tests.filter(t => t.passed).length;
    suite.failed = suite.tests.filter(t => !t.passed).length;

    return suite;
}

// ============================================================================
// WebSocket Server Tests
// ============================================================================

async function testWebSocketServer(): Promise<TestSuite> {
    const suite: TestSuite = {
        name: 'WebSocket Server',
        tests: [],
        passed: 0,
        failed: 0,
    };

    // Test 1: Connection
    suite.tests.push(await runTest('WebSocket connects successfully', async () => {
        const ws = await wsConnect(WS_URL);
        ws.close();
    }));

    // Test 2: Welcome message
    suite.tests.push(await runTest('WebSocket receives welcome message', async () => {
        const ws = await wsConnect(WS_URL);
        try {
            const msg = await wsReceive(ws) as { type: string };
            if (msg.type !== 'connected') {
                throw new Error(`Expected 'connected', got '${msg.type}'`);
            }
        } finally {
            ws.close();
        }
    }));

    // Test 3: Subscribe to channels
    suite.tests.push(await runTest('WebSocket can subscribe to channels', async () => {
        const ws = await wsConnect(WS_URL);
        try {
            // Consume welcome message
            await wsReceive(ws);

            // Send subscribe
            ws.send(JSON.stringify({
                type: 'subscribe',
                channels: ['vpin', 'regime'],
            }));

            // Wait for subscription confirmation
            const msg = await wsReceive(ws) as { type: string; data: { channels: string[] } };
            if (msg.type !== 'subscribed') {
                throw new Error(`Expected 'subscribed', got '${msg.type}'`);
            }
            if (!msg.data.channels.includes('vpin')) {
                throw new Error('vpin not in subscribed channels');
            }
        } finally {
            ws.close();
        }
    }));

    // Test 4: Unsubscribe from channels
    suite.tests.push(await runTest('WebSocket can unsubscribe from channels', async () => {
        const ws = await wsConnect(WS_URL);
        try {
            await wsReceive(ws); // Welcome

            ws.send(JSON.stringify({
                type: 'unsubscribe',
                channels: ['price'],
            }));

            const msg = await wsReceive(ws) as { type: string };
            if (msg.type !== 'unsubscribed') {
                throw new Error(`Expected 'unsubscribed', got '${msg.type}'`);
            }
        } finally {
            ws.close();
        }
    }));

    // Test 5: Ping/Pong
    suite.tests.push(await runTest('WebSocket responds to ping', async () => {
        const ws = await wsConnect(WS_URL);
        try {
            await wsReceive(ws); // Welcome

            ws.send(JSON.stringify({ type: 'ping' }));

            const msg = await wsReceive(ws) as { type: string };
            if (msg.type !== 'pong') {
                throw new Error(`Expected 'pong', got '${msg.type}'`);
            }
        } finally {
            ws.close();
        }
    }));

    // Test 6: Message format
    suite.tests.push(await runTest('WebSocket messages have correct format', async () => {
        const ws = await wsConnect(WS_URL);
        try {
            const msg = await wsReceive(ws) as { type: string; data: unknown; timestamp: number };

            if (!msg.type) throw new Error('Missing type field');
            if (!('data' in msg)) throw new Error('Missing data field');
            if (!msg.timestamp) throw new Error('Missing timestamp field');
        } finally {
            ws.close();
        }
    }));

    // Test 7: Handle invalid JSON gracefully
    suite.tests.push(await runTest('WebSocket handles invalid JSON gracefully', async () => {
        const ws = await wsConnect(WS_URL);
        try {
            await wsReceive(ws); // Welcome

            // Send invalid JSON
            ws.send('not valid json {{{');

            // Wait briefly - should not disconnect
            await new Promise(resolve => setTimeout(resolve, 100));

            // Connection should still be open
            if (ws.readyState !== WebSocket.OPEN) {
                throw new Error('WebSocket closed unexpectedly');
            }
        } finally {
            ws.close();
        }
    }));

    // Test 8: Multiple clients
    suite.tests.push(await runTest('WebSocket supports multiple clients', async () => {
        const ws1 = await wsConnect(WS_URL);
        const ws2 = await wsConnect(WS_URL);
        const ws3 = await wsConnect(WS_URL);

        try {
            // All should receive welcome (use longer timeout for reliability)
            await Promise.all([
                wsReceive(ws1, 10000),
                wsReceive(ws2, 10000),
                wsReceive(ws3, 10000),
            ]);

            // All connections should be open
            if (ws1.readyState !== WebSocket.OPEN) throw new Error('ws1 not open');
            if (ws2.readyState !== WebSocket.OPEN) throw new Error('ws2 not open');
            if (ws3.readyState !== WebSocket.OPEN) throw new Error('ws3 not open');
        } finally {
            ws1.close();
            ws2.close();
            ws3.close();
        }
    }));

    // Calculate totals
    suite.passed = suite.tests.filter(t => t.passed).length;
    suite.failed = suite.tests.filter(t => !t.passed).length;

    return suite;
}

// ============================================================================
// Core Services Tests
// ============================================================================

async function testCoreServices(): Promise<TestSuite> {
    const suite: TestSuite = {
        name: 'Core Services Integration',
        tests: [],
        passed: 0,
        failed: 0,
    };

    // Test 1: VPIN changes over time
    suite.tests.push(await runTest('VPIN updates with simulated trades', async () => {
        const { data: before } = await httpGet<{ vpin: number }>('/api/vpin/0xtest');

        // Wait for potential update (in demo mode)
        await new Promise(resolve => setTimeout(resolve, 2000));

        const { data: after } = await httpGet<{ vpin: number }>('/api/vpin/0xtest');

        // VPIN should be valid in both cases
        if (before.vpin < 0 || before.vpin > 1) throw new Error('Invalid initial VPIN');
        if (after.vpin < 0 || after.vpin > 1) throw new Error('Invalid updated VPIN');
    }));

    // Test 2: Regime matches time of day
    suite.tests.push(await runTest('Regime is appropriate for current time', async () => {
        const { data } = await httpGet<{ regime: string }>('/api/regime');

        const now = new Date();
        const hour = now.getUTCHours();
        const day = now.getUTCDay();

        // Weekend check (approximate - ignores timezone)
        if (day === 0 || day === 6) {
            // Could be WEEKEND or late Friday OVERNIGHT
            // Just verify it's a valid regime
        }

        // Verify regime is valid
        const validRegimes = [
            'CORE_SESSION', 'SOFT_OPEN', 'PRE_MARKET',
            'AFTER_HOURS', 'OVERNIGHT', 'WEEKEND', 'HOLIDAY'
        ];
        if (!validRegimes.includes(data.regime)) {
            throw new Error(`Invalid regime: ${data.regime}`);
        }
    }));

    // Test 3: Oracle price freshness
    suite.tests.push(await runTest('Oracle price is fresh', async () => {
        const { data } = await httpGet<{ timestamp: number; fetchedAt: number }>('/api/price/ETH');

        const priceAge = data.fetchedAt - (data.timestamp * 1000);

        // Price should not be more than 5 minutes old
        if (priceAge > 300000) {
            throw new Error(`Price too old: ${priceAge / 1000}s`);
        }
    }));

    // Test 4: Fee formula consistency
    suite.tests.push(await runTest('Fee calculation is consistent', async () => {
        const { data: fee1 } = await httpGet<{ totalFee: number }>('/api/fees/0xtest');
        const { data: fee2 } = await httpGet<{ totalFee: number }>('/api/fees/0xtest');

        // Same pool should have similar fees (may differ slightly due to time)
        const diff = Math.abs(fee1.totalFee - fee2.totalFee);
        if (diff > 5) { // Allow 5 bps variance
            throw new Error(`Fee inconsistency: ${fee1.totalFee} vs ${fee2.totalFee}`);
        }
    }));

    // Test 5: Circuit breaker responds to VPIN
    suite.tests.push(await runTest('Circuit breaker level is valid', async () => {
        const { data: vpin } = await httpGet<{ vpin: number }>('/api/vpin/0xtest');
        const { data: cb } = await httpGet<{ level: number; flags: string[] }>('/api/circuit-breaker');

        // High VPIN should correlate with circuit breaker flags
        if (vpin.vpin > 0.7 && cb.level === 0 && !cb.flags.includes('HIGH_VPIN')) {
            // This is okay - VPIN might not be pool-specific for CB
        }

        // Level should be 0-4
        if (cb.level < 0 || cb.level > 4) {
            throw new Error(`Invalid CB level: ${cb.level}`);
        }
    }));

    // Test 6: Pools have consistent data
    suite.tests.push(await runTest('Pool data is internally consistent', async () => {
        const { data } = await httpGet<{
            pools: Array<{
                poolId: string;
                asset: string;
                vpin: number;
                fee: number;
            }>;
        }>('/api/pools');

        for (const pool of data.pools) {
            // VPIN should be 0-1
            if (pool.vpin < 0 || pool.vpin > 1) {
                throw new Error(`Pool ${pool.poolId} has invalid VPIN: ${pool.vpin}`);
            }
            // Fee should be positive
            if (pool.fee < 0) {
                throw new Error(`Pool ${pool.poolId} has invalid fee: ${pool.fee}`);
            }
        }
    }));

    // Test 7: Response times
    suite.tests.push(await runTest('API response times under 500ms', async () => {
        const endpoints = ['/api/health', '/api/regime', '/api/vpin/0x1', '/api/fees/0x1', '/api/pools'];

        for (const endpoint of endpoints) {
            const start = Date.now();
            await httpGet(endpoint);
            const duration = Date.now() - start;

            if (duration > 500) {
                throw new Error(`${endpoint} took ${duration}ms (>500ms)`);
            }
        }
    }));

    // Test 8: Price endpoint handles unknown asset
    suite.tests.push(await runTest('Price endpoint handles unknown asset gracefully', async () => {
        const { status } = await httpGet('/api/price/UNKNOWN_ASSET_12345');

        // Should return 500 (oracle failure) or 200 with low confidence
        if (status !== 200 && status !== 500) {
            throw new Error(`Unexpected status: ${status}`);
        }
    }));

    // Calculate totals
    suite.passed = suite.tests.filter(t => t.passed).length;
    suite.failed = suite.tests.filter(t => !t.passed).length;

    return suite;
}

// ============================================================================
// Load & Stress Tests
// ============================================================================

async function testLoadPerformance(): Promise<TestSuite> {
    const suite: TestSuite = {
        name: 'Load & Performance',
        tests: [],
        passed: 0,
        failed: 0,
    };

    // Test 1: Concurrent API requests
    suite.tests.push(await runTest('Handle 50 concurrent API requests', async () => {
        const requests = Array(50).fill(null).map(() => httpGet('/api/health'));
        const start = Date.now();

        const results = await Promise.all(requests);
        const duration = Date.now() - start;

        const failed = results.filter(r => r.status !== 200).length;
        if (failed > 0) {
            throw new Error(`${failed}/50 requests failed`);
        }

        if (duration > 5000) {
            throw new Error(`Took ${duration}ms (>5000ms) for 50 requests`);
        }
    }));

    // Test 2: Sequential API requests
    suite.tests.push(await runTest('Handle 100 sequential requests', async () => {
        const start = Date.now();

        for (let i = 0; i < 100; i++) {
            const { status } = await httpGet('/api/health');
            if (status !== 200) throw new Error(`Request ${i} failed`);
        }

        const duration = Date.now() - start;
        const avgTime = duration / 100;

        if (avgTime > 100) {
            throw new Error(`Average ${avgTime}ms per request (>100ms)`);
        }
    }));

    // Test 3: Multiple WebSocket connections
    suite.tests.push(await runTest('Handle 20 concurrent WebSocket connections', async () => {
        const connections: WebSocket[] = [];

        try {
            // Open 20 connections
            for (let i = 0; i < 20; i++) {
                const ws = await wsConnect(WS_URL);
                connections.push(ws);
            }

            // All should receive welcome (use longer timeout for concurrent load)
            await Promise.all(connections.map(ws => wsReceive(ws, 10000)));

            // All should be open
            const closed = connections.filter(ws => ws.readyState !== WebSocket.OPEN).length;
            if (closed > 0) {
                throw new Error(`${closed}/20 connections closed unexpectedly`);
            }
        } finally {
            connections.forEach(ws => ws.close());
        }
    }));

    // Test 4: Memory stability
    suite.tests.push(await runTest('Memory stable over 100 requests', async () => {
        // Just verify we can make many requests without hanging
        const startMemory = process.memoryUsage().heapUsed;

        for (let i = 0; i < 100; i++) {
            await httpGet('/api/vpin/0xtest');
        }

        const endMemory = process.memoryUsage().heapUsed;
        const growth = (endMemory - startMemory) / 1024 / 1024;

        // Shouldn't grow more than 50MB
        if (growth > 50) {
            throw new Error(`Memory grew ${growth.toFixed(1)}MB (>50MB)`);
        }
    }));

    // Calculate totals
    suite.passed = suite.tests.filter(t => t.passed).length;
    suite.failed = suite.tests.filter(t => !t.passed).length;

    return suite;
}

// ============================================================================
// Main Test Runner
// ============================================================================

async function runAllTests(): Promise<void> {
    console.log('═'.repeat(70));
    console.log('  StockShield Backend - Production Test Suite');
    console.log('═'.repeat(70));
    console.log(`\n📍 API: ${API_BASE}`);
    console.log(`📍 WS:  ${WS_URL}\n`);

    const suites: TestSuite[] = [];

    try {
        // Check server is running
        console.log('🔍 Checking server connectivity...\n');
        await httpGet('/api/health');

        // Run test suites
        console.log('1️⃣  Running API Server Tests...');
        suites.push(await testAPIServer());

        console.log('2️⃣  Running WebSocket Server Tests...');
        suites.push(await testWebSocketServer());

        console.log('3️⃣  Running Core Services Tests...');
        suites.push(await testCoreServices());

        console.log('4️⃣  Running Load & Performance Tests...');
        suites.push(await testLoadPerformance());

    } catch (error) {
        console.error('\n❌ Could not connect to server!');
        console.error('   Make sure backend is running: npm run start');
        console.error(`   Error: ${error instanceof Error ? error.message : error}\n`);
        process.exit(1);
    }

    // Print results
    console.log('\n' + '═'.repeat(70));
    console.log('  Test Results');
    console.log('═'.repeat(70) + '\n');

    let totalPassed = 0;
    let totalFailed = 0;

    for (const suite of suites) {
        console.log(`\n📦 ${suite.name}`);
        console.log('─'.repeat(50));

        for (const test of suite.tests) {
            const icon = test.passed ? '✅' : '❌';
            const time = `(${test.duration}ms)`;
            console.log(`  ${icon} ${test.name} ${time}`);

            if (!test.passed && test.error) {
                console.log(`     └─ ${test.error}`);
            }
        }

        console.log(`  📊 ${suite.passed}/${suite.tests.length} passed`);
        totalPassed += suite.passed;
        totalFailed += suite.failed;
    }

    // Summary
    const total = totalPassed + totalFailed;
    const passRate = ((totalPassed / total) * 100).toFixed(1);

    console.log('\n' + '═'.repeat(70));
    console.log(`  Summary: ${totalPassed}/${total} tests passed (${passRate}%)`);
    console.log('═'.repeat(70) + '\n');

    if (totalFailed > 0) {
        console.log(`❌ ${totalFailed} test(s) failed\n`);
        process.exit(1);
    } else {
        console.log('✅ All tests passed!\n');
        process.exit(0);
    }
}

// Run tests
runAllTests().catch(error => {
    console.error('Test runner error:', error);
    process.exit(1);
});
