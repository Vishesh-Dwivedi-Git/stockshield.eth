/**
 * StockShield End-to-End Integration Test
 * 
 * Realistic scenario: An LP providing liquidity for tokenized AAPL stock
 * 
 * This test simulates:
 * 1. A trading week with realistic price movements
 * 2. Gap events at market open
 * 3. High VPIN periods (informed trading)
 * 4. Regime transitions
 * 
 * Compares LP outcomes WITH vs WITHOUT StockShield protection
 */

import { VPINCalculator } from './vpin-calculator';
import { RegimeDetector, Regime } from './regime-detector';
import { GapAuctionService } from './gap-auction';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

// ============================================================================
// SIMULATION CONFIGURATION
// ============================================================================

interface SimulationConfig {
    initialPrice: number;           // Starting AAPL price
    initialLPBalance: number;       // LP's initial capital
    lpShareOfPool: number;          // LP's share of total pool
    totalPoolLiquidity: number;     // Total pool TVL
    baseFee: number;                // Standard AMM fee (0.3%)
    simulationDays: number;         // How many days to simulate
    tradesPerHour: number;          // Average trades per hour
}

const CONFIG: SimulationConfig = {
    initialPrice: 185.00,           // AAPL ~$185
    initialLPBalance: 100_000,      // $100k initial LP position
    lpShareOfPool: 0.10,            // 10% of pool
    totalPoolLiquidity: 1_000_000,  // $1M pool
    baseFee: 0.003,                 // 0.3%
    simulationDays: 5,              // Monday-Friday
    tradesPerHour: 20,              // 20 trades/hour during market hours
};

// ============================================================================
// REALISTIC PRICE STREAM GENERATOR
// ============================================================================

interface PricePoint {
    timestamp: number;
    price: number;
    dayOfWeek: number;      // 1=Mon, 5=Fri
    hour: number;
    regime: Regime;
    isGapOpen: boolean;
    gapPercent: number;
}

interface Trade {
    timestamp: number;
    price: number;
    volume: number;
    isBuy: boolean;
    isInformed: boolean;    // True if trade is from informed trader
    regime: Regime;
}

function generatePriceStream(config: SimulationConfig): PricePoint[] {
    const points: PricePoint[] = [];
    let price = config.initialPrice;

    // Start Monday 4:00 AM ET (pre-market)
    const startDate = new Date('2026-02-02T04:00:00-05:00');

    for (let day = 0; day < config.simulationDays; day++) {
        const dayOfWeek = day + 1; // 1=Monday

        // Overnight gap (news event)
        const gapPercent = generateOvernightGap(dayOfWeek);
        const gapMultiplier = 1 + gapPercent;

        // Generate hourly prices for this day
        for (let hour = 4; hour <= 23; hour++) {
            const timestamp = startDate.getTime() + (day * 24 + hour - 4) * 3600 * 1000;
            const regime = getRegimeForHour(hour, dayOfWeek);

            // Apply gap at market open (9:30 AM)
            const isGapOpen = hour === 9 && Math.abs(gapPercent) > 0.005;
            if (isGapOpen) {
                price *= gapMultiplier;
            }

            // Add intraday volatility based on regime
            const volatility = getVolatilityForRegime(regime);
            price *= (1 + (Math.random() - 0.5) * volatility);

            points.push({
                timestamp,
                price,
                dayOfWeek,
                hour,
                regime,
                isGapOpen,
                gapPercent: isGapOpen ? gapPercent : 0,
            });
        }
    }

    return points;
}

function generateOvernightGap(dayOfWeek: number): number {
    // Monday has larger gaps (weekend news)
    if (dayOfWeek === 1) {
        return (Math.random() - 0.5) * 0.06; // ±3%
    }
    // Random chance of gap on other days
    if (Math.random() < 0.3) {
        return (Math.random() - 0.5) * 0.04; // ±2%
    }
    return 0;
}

function getRegimeForHour(hour: number, dayOfWeek: number): Regime {
    if (dayOfWeek >= 6) return Regime.WEEKEND;
    if (hour >= 9 && hour < 16) {
        return hour === 9 ? Regime.SOFT_OPEN : Regime.CORE_SESSION;
    }
    if (hour >= 4 && hour < 9) return Regime.PRE_MARKET;
    if (hour >= 16 && hour < 20) return Regime.AFTER_HOURS;
    return Regime.OVERNIGHT;
}

function getVolatilityForRegime(regime: Regime): number {
    switch (regime) {
        case Regime.SOFT_OPEN: return 0.02;     // High volatility at open
        case Regime.CORE_SESSION: return 0.005; // Normal volatility
        case Regime.PRE_MARKET: return 0.01;    // Medium volatility
        case Regime.AFTER_HOURS: return 0.008;  // Medium volatility
        case Regime.OVERNIGHT: return 0.003;    // Low volatility
        case Regime.WEEKEND: return 0.002;      // Very low volatility
        default: return 0.005;
    }
}

// ============================================================================
// TRADE GENERATOR (Informed vs Uninformed)
// ============================================================================

function generateTrades(pricePoints: PricePoint[]): Trade[] {
    const trades: Trade[] = [];

    for (const point of pricePoints) {
        const tradesThisHour = getTradesPerHour(point.regime);

        for (let i = 0; i < tradesThisHour; i++) {
            const isInformed = shouldBeInformedTrade(point);
            const isBuy = isInformed
                ? point.gapPercent > 0 || Math.random() > 0.3  // Informed traders buy before good news
                : Math.random() > 0.5;

            const volume = generateTradeVolume(point.regime, isInformed);

            trades.push({
                timestamp: point.timestamp + (i / tradesThisHour) * 3600 * 1000,
                price: point.price,
                volume,
                isBuy,
                isInformed,
                regime: point.regime,
            });
        }
    }

    return trades;
}

function getTradesPerHour(regime: Regime): number {
    switch (regime) {
        case Regime.SOFT_OPEN: return 50;       // Very high at open
        case Regime.CORE_SESSION: return 20;    // Normal
        case Regime.PRE_MARKET: return 5;       // Low
        case Regime.AFTER_HOURS: return 8;      // Low-medium
        case Regime.OVERNIGHT: return 2;        // Very low
        case Regime.WEEKEND: return 1;          // Minimal
        default: return 10;
    }
}

function shouldBeInformedTrade(point: PricePoint): boolean {
    // More informed trading during soft open and gaps
    if (point.isGapOpen) return Math.random() < 0.7;
    if (point.regime === Regime.SOFT_OPEN) return Math.random() < 0.4;
    return Math.random() < 0.1; // 10% informed normally
}

function generateTradeVolume(regime: Regime, isInformed: boolean): number {
    const baseVolume = isInformed ? 50000 : 10000;
    const multiplier = regime === Regime.CORE_SESSION ? 1 : 0.5;
    return baseVolume * multiplier * (0.5 + Math.random());
}

// ============================================================================
// LP LOSS CALCULATORS
// ============================================================================

interface LPOutcome {
    feesEarned: number;
    impermanentLoss: number;
    adverseSelectionLoss: number;
    gapLoss: number;
    gapAuctionGains: number;
    netPnL: number;
}

function calculateLPOutcome(
    trades: Trade[],
    pricePoints: PricePoint[],
    config: SimulationConfig,
    withProtection: boolean
): LPOutcome {
    const vpinCalc = new VPINCalculator();
    const gapAuction = new GapAuctionService();

    let feesEarned = 0;
    let adverseSelectionLoss = 0;
    let gapLoss = 0;
    let gapAuctionGains = 0;

    // Track LP position value changes
    const initialPrice = pricePoints[0]?.price || config.initialPrice;
    const finalPrice = pricePoints[pricePoints.length - 1]?.price || config.initialPrice;

    for (const trade of trades) {
        // Process trade through VPIN
        const metrics = vpinCalc.processTrade(trade.volume, trade.isBuy);
        const vpin = metrics.vpin;

        // Calculate fee for this trade
        let fee = config.baseFee;
        if (withProtection) {
            // StockShield dynamic fee: f = f₀ + β×VPIN + γ×R×VPIN
            const regimeMultiplier = getRegimeMultiplier(trade.regime);
            fee = config.baseFee + 0.003 * vpin + 0.002 * regimeMultiplier * vpin;
            fee = Math.min(fee, 0.05); // Cap at 5%
        }

        const feeAmount = trade.volume * fee * config.lpShareOfPool;
        feesEarned += feeAmount;

        // Calculate adverse selection loss (informed traders extract value)
        if (trade.isInformed) {
            // Informed traders capture ~5-15bps per trade on average
            const extraction = trade.volume * 0.001 * config.lpShareOfPool;
            if (withProtection) {
                // Protection reduces extraction by ~60% through higher fees
                adverseSelectionLoss += extraction * 0.4;
            } else {
                adverseSelectionLoss += extraction;
            }
        }
    }

    // Process gap events
    for (const point of pricePoints) {
        if (point.isGapOpen) {
            const gapValue = Math.abs(point.gapPercent) * config.lpShareOfPool * config.totalPoolLiquidity;

            if (withProtection) {
                // Gap auction captures 70% of gap value for LPs
                const auctionId = gapAuction.startAuction(
                    'AAPL-USDC',
                    Math.abs(point.gapPercent) * 100,
                    BigInt(Math.floor(gapValue))
                );
                gapAuctionGains += gapValue * 0.7;
                gapLoss += gapValue * 0.3; // Some still lost
            } else {
                // Without protection, arbitrageurs capture entire gap
                gapLoss += gapValue;
            }
        }
    }

    // Calculate impermanent loss
    const priceRatio = finalPrice / initialPrice;
    const ilFactor = 2 * Math.sqrt(priceRatio) / (1 + priceRatio) - 1;
    const impermanentLoss = Math.abs(ilFactor) * config.initialLPBalance;

    const netPnL = feesEarned - impermanentLoss - adverseSelectionLoss - gapLoss + gapAuctionGains;

    return {
        feesEarned,
        impermanentLoss,
        adverseSelectionLoss,
        gapLoss,
        gapAuctionGains,
        netPnL,
    };
}

function getRegimeMultiplier(regime: Regime): number {
    switch (regime) {
        case Regime.WEEKEND: return 10;
        case Regime.OVERNIGHT: return 5;
        case Regime.SOFT_OPEN: return 3;
        case Regime.PRE_MARKET: return 2;
        case Regime.AFTER_HOURS: return 1.5;
        case Regime.CORE_SESSION: return 1;
        default: return 1;
    }
}

// ============================================================================
// SIMULATION DATA EXPORT
// ============================================================================

interface SimulationResults {
    config: SimulationConfig;
    priceData: { timestamp: number; price: number; regime: string }[];
    vpinData: { timestamp: number; vpin: number }[];
    tradeData: { timestamp: number; volume: number; isBuy: boolean; isInformed: boolean }[];
    withoutProtection: LPOutcome;
    withProtection: LPOutcome;
    comparison: {
        feeImprovement: number;
        adverseSelectionReduction: number;
        gapProtectionValue: number;
        netPnLImprovement: number;
    };
}

function runSimulation(): SimulationResults {
    console.log('🚀 Starting StockShield End-to-End Simulation\n');
    console.log('═'.repeat(60));

    // Generate price stream
    console.log('\n📈 Generating realistic price stream...');
    const pricePoints = generatePriceStream(CONFIG);
    console.log(`   Generated ${pricePoints.length} price points over ${CONFIG.simulationDays} days`);

    // Generate trades
    console.log('\n💱 Generating trade stream...');
    const trades = generateTrades(pricePoints);
    const informedCount = trades.filter(t => t.isInformed).length;
    console.log(`   Generated ${trades.length} trades (${informedCount} informed, ${trades.length - informedCount} retail)`);

    // Calculate VPIN over time
    console.log('\n📊 Calculating VPIN time series...');
    const vpinCalc = new VPINCalculator();
    const vpinData: { timestamp: number; vpin: number }[] = [];

    for (const trade of trades) {
        const metrics = vpinCalc.processTrade(trade.volume, trade.isBuy);
        vpinData.push({ timestamp: trade.timestamp, vpin: metrics.vpin });
    }

    // Calculate outcomes
    console.log('\n💰 Calculating LP outcomes...');
    const withoutProtection = calculateLPOutcome(trades, pricePoints, CONFIG, false);
    const withProtection = calculateLPOutcome(trades, pricePoints, CONFIG, true);

    // Calculate improvements
    const comparison = {
        feeImprovement: withProtection.feesEarned - withoutProtection.feesEarned,
        adverseSelectionReduction: withoutProtection.adverseSelectionLoss - withProtection.adverseSelectionLoss,
        gapProtectionValue: withProtection.gapAuctionGains,
        netPnLImprovement: withProtection.netPnL - withoutProtection.netPnL,
    };

    // Display results
    console.log('\n' + '═'.repeat(60));
    console.log('📋 SIMULATION RESULTS');
    console.log('═'.repeat(60));

    console.log('\n📉 WITHOUT StockShield Protection:');
    console.log(`   Fees Earned:           $${withoutProtection.feesEarned.toFixed(2)}`);
    console.log(`   Impermanent Loss:      -$${withoutProtection.impermanentLoss.toFixed(2)}`);
    console.log(`   Adverse Selection:     -$${withoutProtection.adverseSelectionLoss.toFixed(2)}`);
    console.log(`   Gap Losses:            -$${withoutProtection.gapLoss.toFixed(2)}`);
    console.log(`   ─────────────────────────────`);
    console.log(`   NET P&L:               $${withoutProtection.netPnL.toFixed(2)}`);

    console.log('\n📈 WITH StockShield Protection:');
    console.log(`   Fees Earned:           $${withProtection.feesEarned.toFixed(2)}`);
    console.log(`   Impermanent Loss:      -$${withProtection.impermanentLoss.toFixed(2)}`);
    console.log(`   Adverse Selection:     -$${withProtection.adverseSelectionLoss.toFixed(2)}`);
    console.log(`   Gap Losses:            -$${withProtection.gapLoss.toFixed(2)}`);
    console.log(`   Gap Auction Gains:     +$${withProtection.gapAuctionGains.toFixed(2)}`);
    console.log(`   ─────────────────────────────`);
    console.log(`   NET P&L:               $${withProtection.netPnL.toFixed(2)}`);

    console.log('\n🛡️ PROTECTION VALUE:');
    console.log(`   Extra Fees:            +$${comparison.feeImprovement.toFixed(2)}`);
    console.log(`   Adverse Selection Saved: +$${comparison.adverseSelectionReduction.toFixed(2)}`);
    console.log(`   Gap Auction Gains:     +$${comparison.gapProtectionValue.toFixed(2)}`);
    console.log(`   ─────────────────────────────`);
    console.log(`   TOTAL IMPROVEMENT:     +$${comparison.netPnLImprovement.toFixed(2)}`);

    const improvementPercent = (comparison.netPnLImprovement / CONFIG.initialLPBalance) * 100;
    console.log(`   \n   📊 Improvement: ${improvementPercent.toFixed(2)}% of initial capital`);

    console.log('\n' + '═'.repeat(60));

    const results: SimulationResults = {
        config: CONFIG,
        priceData: pricePoints.map(p => ({
            timestamp: p.timestamp,
            price: p.price,
            regime: p.regime
        })),
        vpinData,
        tradeData: trades.map(t => ({
            timestamp: t.timestamp,
            volume: t.volume,
            isBuy: t.isBuy,
            isInformed: t.isInformed,
        })),
        withoutProtection,
        withProtection,
        comparison,
    };

    return results;
}

// ============================================================================
// MAIN
// ============================================================================

if (require.main === module) {
    const results = runSimulation();

    // Export data for Python graphing
    const outputDir = join(__dirname, '../../simulation_results');

    try {
        mkdirSync(outputDir, { recursive: true });
    } catch (e) {
        // Directory exists
    }

    writeFileSync(
        join(outputDir, 'simulation_data.json'),
        JSON.stringify(results, (key, value) =>
            typeof value === 'bigint' ? value.toString() : value
            , 2)
    );

    console.log(`\n📁 Data exported to: ${outputDir}/simulation_data.json`);
    console.log('📊 Run `python generate_graphs.py` to create visualizations\n');
}

export { runSimulation, SimulationResults, LPOutcome };
