/**
 * StockShield API Server
 * 
 * REST API endpoints for frontend integration.
 * WebSocket server for real-time updates.
 */

import http from 'http';
import { VPINCalculator, VPINMetrics } from '../yellow/vpin-calculator';
import { RegimeDetector, RegimeInfo, Regime } from '../yellow/regime-detector';
import { OracleAggregator, OraclePrice } from '../oracle/oracle-aggregator';

// ============================================================================
// Types
// ============================================================================

interface PoolInfo {
    poolId: string;
    asset: string;
    liquidity: string;
    vpin: number;
    fee: number;
    regime: Regime;
}

interface CircuitBreakerState {
    level: number;
    flags: string[];
    actions: string[];
}

interface AuctionInfo {
    id: string;
    poolId: string;
    phase: 'COMMIT' | 'REVEAL' | 'SETTLED';
    gapPercent: number;
    endTime: number;
}

interface FeeComponents {
    baseFee: number;
    vpinComponent: number;
    volatilityComponent: number;
    inventoryComponent: number;
    regimeMultiplier: number;
    totalFee: number;
}

// ============================================================================
// API Server
// ============================================================================

export class APIServer {
    private server: http.Server | null = null;
    private vpinCalc: VPINCalculator;
    private regimeDetector: RegimeDetector;
    private oracleAggregator: OracleAggregator;
    private startTime: number = Date.now();

    // Mock data for demo (since contracts aren't deployed)
    private mockPools: PoolInfo[] = [
        { poolId: '0xaapl', asset: 'AAPL', liquidity: '1000000', vpin: 0.35, fee: 15, regime: Regime.CORE_SESSION },
        { poolId: '0xtsla', asset: 'TSLA', liquidity: '750000', vpin: 0.42, fee: 22, regime: Regime.CORE_SESSION },
        { poolId: '0xeth', asset: 'ETH', liquidity: '2500000', vpin: 0.28, fee: 12, regime: Regime.CORE_SESSION },
    ];

    constructor(
        vpinCalc: VPINCalculator,
        regimeDetector: RegimeDetector,
        oracleAggregator: OracleAggregator
    ) {
        this.vpinCalc = vpinCalc;
        this.regimeDetector = regimeDetector;
        this.oracleAggregator = oracleAggregator;
    }

    /**
     * Start the API server
     */
    start(port: number = 3001): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res);
            });

            this.server.listen(port, () => {
                console.log(`📡 API Server listening on http://localhost:${port}`);
                resolve();
            });

            this.server.on('error', reject);
        });
    }

    /**
     * Stop the API server
     */
    stop(): Promise<void> {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    console.log('📡 API Server stopped');
                    resolve();
                });
            } else {
                resolve();
            }
        });
    }

    /**
     * Handle incoming HTTP requests
     */
    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Content-Type', 'application/json');

        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const pathname = url.pathname;

        try {
            // Route handling
            if (pathname === '/api/health') {
                return this.handleHealth(res);
            }

            if (pathname === '/api/regime') {
                return this.handleRegime(res);
            }

            if (pathname.startsWith('/api/vpin/')) {
                const poolId = pathname.replace('/api/vpin/', '');
                return this.handleVPIN(res, poolId);
            }

            if (pathname.startsWith('/api/price/')) {
                const asset = pathname.replace('/api/price/', '');
                return await this.handlePrice(res, asset);
            }

            if (pathname.startsWith('/api/fees/')) {
                const poolId = pathname.replace('/api/fees/', '');
                return this.handleFees(res, poolId);
            }

            if (pathname === '/api/pools') {
                return this.handlePools(res);
            }

            if (pathname.startsWith('/api/pools/')) {
                const poolId = pathname.replace('/api/pools/', '');
                return this.handlePoolDetail(res, poolId);
            }

            if (pathname === '/api/circuit-breaker') {
                return this.handleCircuitBreaker(res);
            }

            if (pathname === '/api/auctions/active') {
                return this.handleActiveAuctions(res);
            }

            // 404 Not Found
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not Found', path: pathname }));

        } catch (error) {
            console.error('API Error:', error);
            res.writeHead(500);
            res.end(JSON.stringify({
                error: 'Internal Server Error',
                message: error instanceof Error ? error.message : 'Unknown error'
            }));
        }
    }

    // ========================================================================
    // Route Handlers
    // ========================================================================

    private handleHealth(res: http.ServerResponse): void {
        const uptime = Math.floor((Date.now() - this.startTime) / 1000);
        const response = {
            status: 'healthy',
            uptime,
            services: {
                vpin: 'active',
                regime: 'active',
                oracle: 'active',
            },
            timestamp: Date.now(),
        };
        res.writeHead(200);
        res.end(JSON.stringify(response));
    }

    private handleRegime(res: http.ServerResponse): void {
        const regimeInfo = this.regimeDetector.getCurrentRegime();
        const nextTransition = this.regimeDetector.getTimeUntilNextRegime();

        const response = {
            regime: regimeInfo.regime,
            multiplier: regimeInfo.multiplier,
            baseFee: regimeInfo.baseFee,
            maxFee: regimeInfo.maxFee,
            riskLevel: regimeInfo.riskLevel,
            nextTransition: {
                regime: nextTransition.nextRegime,
                secondsUntil: nextTransition.secondsUntil,
            },
            timestamp: Date.now(),
        };
        res.writeHead(200);
        res.end(JSON.stringify(response));
    }

    private handleVPIN(res: http.ServerResponse, poolId: string): void {
        const metrics = this.vpinCalc.getMetrics();
        const interpretation = this.vpinCalc.getInterpretation(metrics.vpin);

        const response = {
            poolId,
            vpin: metrics.vpin,
            bucketCount: metrics.bucketsFilled,
            bucketSize: metrics.bucketSize,
            interpretation: interpretation.level,
            description: interpretation.description,
            recommendedAction: interpretation.recommendedAction,
            timestamp: Date.now(),
        };
        res.writeHead(200);
        res.end(JSON.stringify(response));
    }

    private async handlePrice(res: http.ServerResponse, asset: string): Promise<void> {
        // Mock prices for fallback when oracles are slow/unavailable
        const mockPrices: Record<string, number> = {
            'ETH': 3200,
            'BTC': 95000,
            'AAPL': 185,
            'TSLA': 250,
        };

        try {
            // Race between oracle call and timeout
            const timeoutPromise = new Promise<null>((resolve) =>
                setTimeout(() => resolve(null), 5000)
            );

            const pricePromise = this.oracleAggregator.getConsensusPrice(asset.toUpperCase());
            const price = await Promise.race([pricePromise, timeoutPromise]);

            if (price && price.price > 0n) {
                // Real price from oracle
                const priceNumber = Number(price.price) / 1e18;

                const response = {
                    asset: asset.toUpperCase(),
                    price: priceNumber,
                    priceRaw: price.price.toString(),
                    source: price.source,
                    confidence: price.confidence,
                    timestamp: price.timestamp,
                    fetchedAt: Date.now(),
                };
                res.writeHead(200);
                res.end(JSON.stringify(response));
            } else {
                // Fallback to mock price
                const mockPrice = mockPrices[asset.toUpperCase()] || 100;
                const response = {
                    asset: asset.toUpperCase(),
                    price: mockPrice,
                    priceRaw: (BigInt(Math.floor(mockPrice)) * BigInt(10 ** 18)).toString(),
                    source: 'mock' as const,
                    confidence: 0.5,
                    timestamp: Date.now() / 1000,
                    fetchedAt: Date.now(),
                };
                res.writeHead(200);
                res.end(JSON.stringify(response));
            }
        } catch (error) {
            // Error fallback - return mock price with low confidence
            const mockPrice = mockPrices[asset.toUpperCase()] || 100;
            const response = {
                asset: asset.toUpperCase(),
                price: mockPrice,
                priceRaw: (BigInt(Math.floor(mockPrice)) * BigInt(10 ** 18)).toString(),
                source: 'mock' as const,
                confidence: 0.3,
                timestamp: Date.now() / 1000,
                fetchedAt: Date.now(),
            };
            res.writeHead(200);
            res.end(JSON.stringify(response));
        }
    }

    private handleFees(res: http.ServerResponse, poolId: string): void {
        const regimeInfo = this.regimeDetector.getCurrentRegime();
        const vpin = this.vpinCalc.getVPIN();

        // Calculate fee components (simplified version of contract logic)
        const baseFee = regimeInfo.baseFee;
        const vpinComponent = Math.floor(vpin * 30); // β = 0.3
        const volatilityComponent = 5; // Mock volatility
        const inventoryComponent = 2; // Mock inventory

        const totalBeforeMultiplier = baseFee + vpinComponent + volatilityComponent + inventoryComponent;
        const totalFee = Math.min(
            Math.floor(totalBeforeMultiplier * regimeInfo.multiplier),
            regimeInfo.maxFee
        );

        const response: FeeComponents = {
            baseFee,
            vpinComponent,
            volatilityComponent,
            inventoryComponent,
            regimeMultiplier: regimeInfo.multiplier,
            totalFee,
        };
        res.writeHead(200);
        res.end(JSON.stringify({ poolId, ...response, timestamp: Date.now() }));
    }

    private handlePools(res: http.ServerResponse): void {
        // Update mock pools with current regime
        const regimeInfo = this.regimeDetector.getCurrentRegime();
        const vpin = this.vpinCalc.getVPIN();

        const pools = this.mockPools.map(pool => ({
            ...pool,
            regime: regimeInfo.regime,
            vpin: Math.max(0, Math.min(1, vpin + (Math.random() * 0.1 - 0.05))), // Slight variation per pool, clamped to 0-1
        }));

        const response = {
            pools,
            count: pools.length,
            timestamp: Date.now(),
        };
        res.writeHead(200);
        res.end(JSON.stringify(response));
    }

    private handlePoolDetail(res: http.ServerResponse, poolId: string): void {
        const pool = this.mockPools.find(p => p.poolId === poolId);

        if (!pool) {
            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Pool not found', poolId }));
            return;
        }

        const regimeInfo = this.regimeDetector.getCurrentRegime();
        const vpin = this.vpinCalc.getVPIN();

        const response = {
            ...pool,
            regime: regimeInfo.regime,
            vpin,
            regimeInfo: {
                multiplier: regimeInfo.multiplier,
                baseFee: regimeInfo.baseFee,
                maxFee: regimeInfo.maxFee,
                riskLevel: regimeInfo.riskLevel,
            },
            timestamp: Date.now(),
        };
        res.writeHead(200);
        res.end(JSON.stringify(response));
    }

    private handleCircuitBreaker(res: http.ServerResponse): void {
        const vpin = this.vpinCalc.getVPIN();

        // Calculate circuit breaker level based on VPIN and other factors
        let level = 0;
        const flags: string[] = [];
        const actions: string[] = [];

        if (vpin > 0.7) {
            level++;
            flags.push('HIGH_VPIN');
            actions.push('Increased fees by 50%');
        }
        if (vpin > 0.8) {
            level++;
            flags.push('EXTREME_VPIN');
            actions.push('Reduced liquidity depth by 50%');
        }
        // Could add more flags: ORACLE_STALE, PRICE_DEVIATION, INVENTORY_IMBALANCE

        const response: CircuitBreakerState = {
            level,
            flags,
            actions,
        };
        res.writeHead(200);
        res.end(JSON.stringify({ ...response, timestamp: Date.now() }));
    }

    private handleActiveAuctions(res: http.ServerResponse): void {
        // Mock active auctions (no real contract yet)
        const auctions: AuctionInfo[] = [];

        // Could add mock auction based on regime transitions
        const regimeInfo = this.regimeDetector.getCurrentRegime();
        if (regimeInfo.regime === Regime.SOFT_OPEN) {
            auctions.push({
                id: '0xauction1',
                poolId: '0xaapl',
                phase: 'COMMIT',
                gapPercent: 2.5,
                endTime: Date.now() + 30000, // 30 seconds
            });
        }

        const response = {
            auctions,
            count: auctions.length,
            timestamp: Date.now(),
        };
        res.writeHead(200);
        res.end(JSON.stringify(response));
    }
}
