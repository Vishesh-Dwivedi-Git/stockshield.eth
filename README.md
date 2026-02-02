<!-- <p align="center">
  <img src="docs/assets/logo.png" alt="StockShield Logo" width="200" />
</p> -->

<h1 align="center">🛡️ StockShield Protocol</h1>

<p align="center">
  <strong>The LP Protection Layer for the Tokenized Securities Era</strong>
</p>

<p align="center">
  <a href="#features"><img src="https://img.shields.io/badge/Uniswap-v4%20Hook-FF007A?style=for-the-badge&logo=uniswap&logoColor=white" alt="Uniswap v4" /></a>
  <a href="#architecture"><img src="https://img.shields.io/badge/Yellow%20Network-Integrated-FFD700?style=for-the-badge" alt="Yellow Network" /></a>
  <a href="#contracts"><img src="https://img.shields.io/badge/Solidity-0.8.24-363636?style=for-the-badge&logo=solidity&logoColor=white" alt="Solidity" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue?style=for-the-badge" alt="License" /></a>
</p>

<p align="center">
  <a href="#-the-problem">Problem</a> •
  <a href="#-the-solution">Solution</a> •
  <a href="#-architecture">Architecture</a> •
  <a href="#-quick-start">Quick Start</a> •
  <a href="#-documentation">Docs</a>
</p>

---

## 📖 Overview

**StockShield** (also known as **AURA Protocol**) is a cutting-edge Uniswap v4 Hook designed to protect liquidity providers in **tokenized securities pools** from two critical attack vectors:

1. **⏰ Session Boundary Gaps** — Price divergence during market closures (nights, weekends, holidays)
2. **📊 Continuous LVR** — Loss-versus-rebalancing during trading hours

> *"We're not building another LVR solution. We're building the LP protection layer for the tokenized securities era."*

---

## 🚨 The Problem

### Two Worlds Colliding

```mermaid
flowchart LR
    subgraph TradFi["🏛️ Traditional Markets"]
        A[NYSE: 9:30 AM - 4:00 PM ET]
        B[Extended: 22 hours/day]
        C[2-hour daily gap]
        D[Weekend closures]
    end
    
    subgraph DeFi["🌐 DeFi AMMs"]
        E[Trade 24/7/365]
        F[No market hours concept]
        G[Price = last trade]
    end
    
    TradFi -->|Tokenized Stocks| Collision{💥 Collision Zone}
    DeFi --> Collision
    Collision --> Loss["📉 LP Losses"]
```

### The Gap Attack Scenario

```mermaid
sequenceDiagram
    participant NYSE
    participant Pool as Uniswap Pool
    participant Arb as Arbitrageur
    participant LP as Liquidity Provider
    
    Note over NYSE,LP: Friday 4:00 PM ET
    NYSE->>NYSE: Closes at $200
    Pool->>Pool: Frozen at $200
    
    Note over NYSE,LP: Weekend: News breaks!
    NYSE->>NYSE: True value → $240
    
    Note over NYSE,LP: Monday 9:30 AM ET
    NYSE->>NYSE: Opens at $240
    Pool->>Pool: Still shows $200
    
    Arb->>Pool: Buy at $200
    Arb->>NYSE: Sell at $240
    Arb->>Arb: Profit: $40/token 💰
    
    LP->>LP: Loss: $40/token 😢
```

### Historical Gap Data (2024)

| 📅 Weekend Event | 📊 Gap Size |
|-----------------|-------------|
| Apple Earnings (July) | **+11.4%** |
| Fed Rate Surprise (March) | **-9.5%** |
| Geopolitical Event (Oct) | **-9.0%** |
| *Average Weekend Gap* | *±3.2%* |

> **Impact**: At 3% avg gap × 70% arbitrage capture × 52 weekends × billions in TVL = **Hundreds of millions in annual LP losses**

---

## 💡 The Solution

StockShield implements **dual-mode protection** through a unified auction architecture:

```mermaid
stateDiagram-v2
    [*] --> CLOSED: Market Closes
    CLOSED --> SOFT_OPEN: Market Opens
    SOFT_OPEN --> OPEN: 5 min elapsed
    OPEN --> CLOSED: Market Closes
    
    state CLOSED {
        direction LR
        [*] --> BlockTrades
        BlockTrades --> [*]: No swaps allowed
    }
    
    state SOFT_OPEN {
        direction LR
        [*] --> DetectGap
        DetectGap --> GapAuction: Gap > threshold
        GapAuction --> [*]: 70% LP capture
    }
    
    state OPEN {
        direction LR
        [*] --> FlashCommit
        FlashCommit --> LVRAuction
        LVRAuction --> [*]: 90% LP capture
    }
```

### Mode 1: Session Boundary Protection (SOFT_OPEN)

When NYSE transitions from CLOSED → OPEN:

```
┌─────────────────────────────────────────────────────────────┐
│                    GAP AUCTION FLOW                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   Pyth Oracle: Real Price = $240                           │
│   Pool Price: $200                                          │
│   Gap: 20%                                                  │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐  │
│   │ MINIMUM BID DECAY SCHEDULE                           │  │
│   ├─────────────────────────────────────────────────────┤  │
│   │ Minute 0:  ██████████████████████████████  70%       │  │
│   │ Minute 1:  ████████████████████████        56%       │  │
│   │ Minute 2:  ██████████████████              42%       │  │
│   │ Minute 3:  ████████████                    28%       │  │
│   │ Minute 4:  ██████                          14%       │  │
│   │ Minute 5+: Normal Flash-Commit Mode        ──        │  │
│   └─────────────────────────────────────────────────────┘  │
│                                                             │
│   Winner bids $35 → LP captures $35 of $40 gap (87.5%)     │
└─────────────────────────────────────────────────────────────┘
```

### Mode 2: Continuous LVR Protection (OPEN)

During trading hours, Flash-Commit auctions run every block:

```mermaid
sequenceDiagram
    participant User
    participant ClearNode as Yellow ClearNode
    participant Solvers
    participant Hook as StockShield Hook
    participant Pool as Uniswap v4 Pool
    
    rect rgb(25, 25, 112)
        Note over User,Solvers: OFF-CHAIN (~500ms)
        User->>ClearNode: RequestQuote
        ClearNode->>Solvers: RFQ
        Solvers->>ClearNode: SignedBids
        ClearNode->>User: WinningCertificate
    end
    
    rect rgb(0, 100, 0)
        Note over User,Pool: ON-CHAIN (1 block)
        User->>Hook: swap(hookData: Certificate)
        Hook->>Hook: Verify signature
        Hook->>Hook: Check block validity
        Hook->>Pool: Execute swap
        Hook->>Hook: Capture surplus → LPs
    end
```

---

## 🏗️ Architecture

### System Overview

```mermaid
flowchart TB
    subgraph External["📡 External Sources"]
        NYSE[("NYSE Calendar")]
        Pyth[("Pyth Oracle")]
        Yellow[("Yellow ClearNode")]
        ENS[("ENS Registry")]
    end
    
    subgraph OnChain["⛓️ On-Chain Layer"]
        Hook["StockShieldHook.sol\n(Core Protection Logic)"]
        Vault["MarginVault.sol\n(LP Collateral)"]
        Regime["RegimeOracle.sol\n(Market Hours)"]
        Gap["GapAuction.sol\n(Commit-Reveal)"]
        Resolver["StockShieldResolver.sol\n(ENS + Reputation)"]
    end
    
    subgraph OffChain["🖥️ Off-Chain Services"]
        VPIN["VPIN Calculator\n(Trade Flow Toxicity)"]
        Oracle["Oracle Aggregator\n(Multi-source Prices)"]
        RegimeService["Regime Detector\n(Market State)"]
        StateChannel["State Channel\n(Yellow Integration)"]
    end
    
    subgraph Pool["💧 Uniswap v4"]
        PM[("PoolManager")]
    end
    
    NYSE --> Regime
    Pyth --> Oracle
    Yellow --> StateChannel
    ENS --> Resolver
    
    Oracle --> Hook
    VPIN --> Hook
    RegimeService --> Regime
    StateChannel --> Hook
    
    Hook --> PM
    Vault --> Hook
    Regime --> Hook
    Gap --> Hook
    Resolver --> Hook
```

### Smart Contract Architecture

```
contracts/
├── src/
│   ├── StockShieldHook.sol      ⟵ Core Uniswap v4 hook (CRITICAL)
│   ├── MarginVault.sol          ⟵ LP collateral + state channels (HIGH)
│   ├── RegimeOracle.sol         ⟵ Market hours detection (HIGH)
│   ├── GapAuction.sol           ⟵ Commit-reveal gap auction (MEDIUM)
│   └── StockShieldResolver.sol  ⟵ ENS resolver + reputation (MEDIUM)
├── test/
│   └── *.t.sol                  ⟵ Foundry tests
├── script/
│   └── Deploy.s.sol             ⟵ Deployment scripts
└── foundry.toml
```

### Market Regime State Machine

```mermaid
flowchart LR
    subgraph Weekday["📅 Weekdays (Mon-Fri)"]
        PRE["🌅 PRE_MARKET\n4:00-9:30 AM\n2x multiplier"]
        SOFT["🔸 SOFT_OPEN\n9:30-9:35 AM\n1.5x + Gap Auction"]
        CORE["☀️ CORE_SESSION\n9:35-4:00 PM\n1x multiplier"]
        AFTER["🌆 AFTER_HOURS\n4:00-8:00 PM\n2x multiplier"]
        NIGHT["🌙 OVERNIGHT\n8:00 PM-4:00 AM\n4x multiplier"]
    end
    
    subgraph Weekend["📅 Weekend"]
        WE["🔒 WEEKEND\nFri 8PM - Mon 4AM\n6x multiplier"]
    end
    
    subgraph Holiday["📅 Holidays"]
        HOL["🎄 HOLIDAY\nAll day\n6x multiplier"]
    end
    
    NIGHT --> PRE
    PRE --> SOFT
    SOFT --> CORE
    CORE --> AFTER
    AFTER --> NIGHT
    
    AFTER -->|Friday| WE
    WE -->|Monday| PRE
```

---

## 📊 Fee Parameters

| Regime | Base Fee (f₀) | Multiplier (R) | Max Fee |
|--------|:-------------:|:--------------:|:-------:|
| **CORE_SESSION** | 5 bps | 1.0x | 50 bps |
| **SOFT_OPEN** | 10 bps | 1.5x | 75 bps |
| **PRE_MARKET** | 15 bps | 2.0x | 100 bps |
| **AFTER_HOURS** | 15 bps | 2.0x | 100 bps |
| **OVERNIGHT** | 30 bps | 4.0x | 300 bps |
| **WEEKEND** | 50 bps | 6.0x | 500 bps |
| **HOLIDAY** | 50 bps | 6.0x | 500 bps |

### Dynamic Fee Formula

```
fee = f₀ + α×σ² + β×VPIN + γ×R×(σ² + VPIN) + δ×|I|
```

Where:

- **f₀** = Base fee by regime
- **α** = Volatility sensitivity (0.5)
- **σ²** = Realized volatility (EMA)
- **β** = VPIN sensitivity (0.3)
- **R** = Regime multiplier
- **δ** = Inventory impact (0.02)
- **I** = Inventory imbalance

---

## 📈 Economic Value

```mermaid
pie title LP Value Capture
    "Gap Arbitrage (Captured)" : 22
    "LVR (Captured)" : 54
    "Swap Fees" : 24
```

| Metric | Without StockShield | With StockShield |
|--------|:-------------------:|:----------------:|
| Gap Loss | -$32M | **+$22M** (captured) |
| LVR Loss | -$60M | **+$54M** (captured) |
| **Net Annual** | **-$92M** | **+$76M** |

---

## 🔐 Security Features

### Circuit Breaker System

```mermaid
flowchart LR
    Normal["🟢 NORMAL\nLevel 0"]
    Warning["🟡 WARNING\nLevel 1"]
    Caution["🟠 CAUTION\nLevel 2"]
    Danger["🔴 DANGER\nLevel 3"]
    Pause["⛔ PAUSE\nLevel 4"]
    
    Normal -->|1 flag| Warning
    Warning -->|2 flags| Caution
    Caution -->|3 flags| Danger
    Danger -->|4 flags| Pause
    
    subgraph Flags["🚩 Circuit Breaker Flags"]
        F1["Oracle stale > 60s"]
        F2["Price deviation > 3%"]
        F3["VPIN > 0.7"]
        F4["Inventory > 40%"]
    end
```

### Multi-Source Oracle Consensus

```mermaid
flowchart TB
    subgraph Sources["📡 Oracle Sources"]
        CL["Chainlink\n(Primary, ~20s)"]
        PY["Pyth Network\n(Secondary, ~1s)"]
        TW["On-chain TWAP\n(Tertiary, per-block)"]
    end
    
    CL --> Consensus
    PY --> Consensus
    TW --> Consensus
    
    Consensus{{"🔄 Consensus\nEngine"}}
    
    Consensus --> Fresh["Filter stale\n(> 60s old)"]
    Fresh --> Median["Calculate\nmedian"]
    Median --> Confidence["Assess\nconfidence"]
    
    Confidence -->|Deviation < 1%| High["✅ High (1.0)"]
    Confidence -->|Deviation < 5%| Medium["⚠️ Medium (0.8)"]
    Confidence -->|Deviation > 5%| Low["❌ Low (0.5)"]
```

---

## 🚀 Quick Start

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/) or npm

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/stockshield.git
cd stockshield

# Install contract dependencies
cd contracts
forge install

# Install backend dependencies
cd ../backend
npm install
```

### Build & Test

```bash
# Build contracts
cd contracts
forge build

# Run tests
forge test

# Run tests with gas reporting
forge test --gas-report

# Format code
forge fmt
```

### Local Development

```bash
# Start local Ethereum node
anvil

# Deploy contracts (in another terminal)
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --private-key <key> --broadcast

# Start backend services
cd backend
npm run dev
```

---

## 📁 Project Structure

```
stockshield/
├── 📄 README.md              ← You are here
├── 📁 contracts/             ← Solidity smart contracts (Foundry)
│   ├── src/
│   │   ├── StockShieldHook.sol
│   │   ├── MarginVault.sol
│   │   ├── RegimeOracle.sol
│   │   ├── GapAuction.sol
│   │   └── StockShieldResolver.sol
│   ├── test/
│   └── script/
├── 📁 backend/               ← Off-chain services (TypeScript)
│   ├── src/
│   ├── oracle/               ← Oracle aggregation
│   ├── regime/               ← Market regime detection
│   └── clearnode/            ← Yellow Network integration
├── 📁 frontend/              ← Web interface
└── 📁 docs/                  ← Documentation
```

---

## 🏆 Prize Tracks

| Prize | Integration | Amount |
|-------|-------------|:------:|
| **Yellow Network** | Dual-mode auction engine on ClearNode | **$15K** |
| **Uniswap Foundation** | Market-hours aware v4 hook | **$5K** |
| **ENS** | Solver identity via subdomains | **$5K** |

---

## 🤝 Competitive Advantage

```mermaid
quadrantChart
    title LP Protection Landscape
    x-axis No Session Awareness --> Full Session Awareness
    y-axis No LVR Protection --> Full LVR Protection
    quadrant-1 Complete Protection
    quadrant-2 Session Only
    quadrant-3 No Protection
    quadrant-4 LVR Only
    StockShield: [0.9, 0.9]
    Angstrom: [0.1, 0.85]
    CoW Swap: [0.1, 0.75]
    trading-days.hook: [0.8, 0.1]
    Vanilla AMM: [0.1, 0.1]
```

| Project | Session Gaps | Continuous LVR | Tokenized Focus |
|---------|:------------:|:--------------:|:---------------:|
| trading-days.hook | ✅ Blocks trades | ❌ | ❌ |
| CoW Swap | ❌ | ✅ Batch | ❌ |
| Angstrom | ❌ | ✅ Block | ❌ |
| **StockShield** | **✅ Gap capture (70%)** | **✅ Flash-Commit (90%)** | **✅** |

---

## 📚 Documentation

- 📖 [Whitepaper](./docs/whitepaper.pdf) — Comprehensive protocol specification
- 🔧 [Developer Handbook](./docs/developer-handbook.pdf) — Technical implementation guide
- 📐 [Math Formulas](./MATH_FORMULAS.md) — Fee and auction calculations
- 🎯 [Demo Strategy](./DEMO_STRATEGY.md) — Hackathon demo scenarios

---

## 🗺️ Roadmap

```mermaid
gantt
    title StockShield Development Roadmap
    dateFormat  YYYY-MM
    section Phase 1
    Core Hook Development     :2026-01, 2M
    Gap Auction MVP           :2026-02, 1M
    Testnet Deployment        :2026-03, 1M
    section Phase 2
    Yellow Network Integration:2026-03, 2M
    ENS Resolver              :2026-04, 1M
    Mainnet Beta              :2026-05, 1M
    section Phase 3
    Multi-asset Support       :2026-06, 2M
    DAO Governance            :2026-07, 2M
    Production Launch         :2026-08, 1M
```

---

## 👥 Team

Built with ❤️ for [HackMoney 2026](https://hackmoney.xyz)

---

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  <strong>🛡️ StockShield Protocol — Protecting LPs in the Tokenized Securities Era</strong>
</p>

<p align="center">
  <a href="https://twitter.com/stockshield">Twitter</a> •
  <a href="https://discord.gg/stockshield">Discord</a> •
  <a href="https://stockshield.xyz">Website</a>
</p>
