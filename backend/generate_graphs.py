#!/usr/bin/env python3
"""
StockShield Simulation Graph Generator

Reads simulation data from JSON and creates visualizations showing
LP outcomes with and without StockShield protection.
"""

import json
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from datetime import datetime
import numpy as np
import os

# Set style
plt.style.use('seaborn-v0_8-darkgrid')
plt.rcParams['figure.figsize'] = [12, 6]
plt.rcParams['font.size'] = 11

def load_data(filepath='simulation_results/simulation_data.json'):
    """Load simulation results from JSON file."""
    with open(filepath, 'r') as f:
        return json.load(f)

def timestamp_to_datetime(ts):
    """Convert timestamp to datetime object."""
    return datetime.fromtimestamp(ts / 1000)

def create_price_chart(data, output_dir):
    """Create price chart with regime coloring."""
    fig, ax = plt.subplots(figsize=(14, 6))
    
    price_data = data['priceData']
    timestamps = [timestamp_to_datetime(p['timestamp']) for p in price_data]
    prices = [p['price'] for p in price_data]
    regimes = [p['regime'] for p in price_data]
    
    # Color mapping for regimes
    regime_colors = {
        'CORE_SESSION': '#27ae60',   # Green
        'SOFT_OPEN': '#f39c12',      # Orange
        'PRE_MARKET': '#3498db',     # Blue
        'AFTER_HOURS': '#9b59b6',    # Purple
        'OVERNIGHT': '#34495e',      # Dark gray
        'WEEKEND': '#95a5a6',        # Light gray
    }
    
    # Plot price line
    ax.plot(timestamps, prices, 'b-', linewidth=1.5, alpha=0.8, label='AAPL Price')
    
    # Color background by regime
    prev_regime = None
    start_idx = 0
    for i, regime in enumerate(regimes):
        if regime != prev_regime:
            if prev_regime is not None:
                color = regime_colors.get(prev_regime, '#cccccc')
                ax.axvspan(timestamps[start_idx], timestamps[i-1], 
                           alpha=0.15, color=color, label=prev_regime if i == len(regimes)-1 else None)
            start_idx = i
            prev_regime = regime
    
    # Add initial price reference line
    initial_price = prices[0]
    ax.axhline(y=initial_price, color='r', linestyle='--', alpha=0.5, label=f'Initial: ${initial_price:.2f}')
    
    # Formatting
    ax.set_title('AAPL Tokenized Stock Price Over Trading Week', fontsize=14, fontweight='bold')
    ax.set_xlabel('Date/Time (ET)')
    ax.set_ylabel('Price ($)')
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%a %H:%M'))
    ax.xaxis.set_major_locator(mdates.HourLocator(interval=8))
    plt.xticks(rotation=45)
    
    # Add regime legend
    from matplotlib.patches import Patch
    legend_elements = [
        Patch(facecolor='#27ae60', alpha=0.3, label='Core Session (9:35a-4p)'),
        Patch(facecolor='#f39c12', alpha=0.3, label='Soft Open (9:30a-9:35a)'),
        Patch(facecolor='#3498db', alpha=0.3, label='Pre-Market (4a-9:30a)'),
        Patch(facecolor='#9b59b6', alpha=0.3, label='After Hours (4p-8p)'),
        Patch(facecolor='#34495e', alpha=0.3, label='Overnight (8p-4a)'),
    ]
    ax.legend(handles=legend_elements, loc='upper left', fontsize=9)
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'price_chart.png'), dpi=150, bbox_inches='tight')
    plt.close()
    print('✅ Created: price_chart.png')

def create_vpin_chart(data, output_dir):
    """Create VPIN time series chart showing order flow toxicity."""
    fig, ax = plt.subplots(figsize=(14, 5))
    
    vpin_data = data['vpinData']
    timestamps = [timestamp_to_datetime(p['timestamp']) for p in vpin_data]
    vpins = [p['vpin'] for p in vpin_data]
    
    # Plot VPIN
    ax.plot(timestamps, vpins, 'b-', linewidth=0.8, alpha=0.7)
    ax.fill_between(timestamps, vpins, alpha=0.3)
    
    # Add threshold lines
    ax.axhline(y=0.3, color='orange', linestyle='--', alpha=0.7, label='Elevated (30%)')
    ax.axhline(y=0.5, color='red', linestyle='--', alpha=0.7, label='High Risk (50%)')
    ax.axhline(y=0.7, color='darkred', linestyle='--', alpha=0.7, label='Extreme (70%)')
    
    # Highlight high VPIN periods
    high_vpin_mask = np.array(vpins) > 0.5
    for i in range(len(timestamps)):
        if vpins[i] > 0.5:
            ax.axvspan(timestamps[max(0, i-1)], timestamps[min(len(timestamps)-1, i+1)], 
                      alpha=0.2, color='red')
    
    ax.set_title('VPIN (Order Flow Toxicity) Over Trading Week', fontsize=14, fontweight='bold')
    ax.set_xlabel('Date/Time (ET)')
    ax.set_ylabel('VPIN Score')
    ax.set_ylim(0, 1)
    ax.xaxis.set_major_formatter(mdates.DateFormatter('%a %H:%M'))
    ax.xaxis.set_major_locator(mdates.HourLocator(interval=8))
    plt.xticks(rotation=45)
    ax.legend(loc='upper right')
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'vpin_chart.png'), dpi=150, bbox_inches='tight')
    plt.close()
    print('✅ Created: vpin_chart.png')

def create_comparison_chart(data, output_dir):
    """Create side-by-side comparison of LP outcomes."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 6))
    
    without = data['withoutProtection']
    with_prot = data['withProtection']
    
    # Left chart: Component breakdown
    ax1 = axes[0]
    
    categories = ['Fees\nEarned', 'Impermanent\nLoss', 'Adverse\nSelection', 'Gap\nLosses', 'Gap Auction\nGains']
    without_vals = [
        without['feesEarned'],
        -without['impermanentLoss'],
        -without['adverseSelectionLoss'],
        -without['gapLoss'],
        0
    ]
    with_vals = [
        with_prot['feesEarned'],
        -with_prot['impermanentLoss'],
        -with_prot['adverseSelectionLoss'],
        -with_prot['gapLoss'],
        with_prot['gapAuctionGains']
    ]
    
    x = np.arange(len(categories))
    width = 0.35
    
    bars1 = ax1.bar(x - width/2, without_vals, width, label='Without Protection', color='#e74c3c', alpha=0.8)
    bars2 = ax1.bar(x + width/2, with_vals, width, label='With StockShield', color='#27ae60', alpha=0.8)
    
    ax1.set_ylabel('Amount ($)')
    ax1.set_title('LP P&L Component Breakdown', fontsize=13, fontweight='bold')
    ax1.set_xticks(x)
    ax1.set_xticklabels(categories, fontsize=10)
    ax1.legend()
    ax1.axhline(y=0, color='black', linewidth=0.5)
    
    # Add value labels
    for bar in bars1:
        height = bar.get_height()
        ax1.annotate(f'${height:,.0f}',
                    xy=(bar.get_x() + bar.get_width() / 2, height),
                    xytext=(0, 3 if height >= 0 else -10),
                    textcoords="offset points",
                    ha='center', va='bottom' if height >= 0 else 'top',
                    fontsize=8)
    for bar in bars2:
        height = bar.get_height()
        ax1.annotate(f'${height:,.0f}',
                    xy=(bar.get_x() + bar.get_width() / 2, height),
                    xytext=(0, 3 if height >= 0 else -10),
                    textcoords="offset points",
                    ha='center', va='bottom' if height >= 0 else 'top',
                    fontsize=8)
    
    # Right chart: Net P&L comparison
    ax2 = axes[1]
    
    labels = ['Without\nProtection', 'With\nStockShield']
    values = [without['netPnL'], with_prot['netPnL']]
    colors = ['#e74c3c' if v < 0 else '#27ae60' for v in values]
    
    bars = ax2.bar(labels, values, color=colors, alpha=0.8, edgecolor='black', linewidth=1.5)
    
    ax2.set_ylabel('Net P&L ($)')
    ax2.set_title('Total LP Performance Comparison', fontsize=13, fontweight='bold')
    ax2.axhline(y=0, color='black', linewidth=0.5)
    
    # Add value labels
    for bar, val in zip(bars, values):
        height = bar.get_height()
        color = 'red' if val < 0 else 'green'
        ax2.annotate(f'${val:,.0f}',
                    xy=(bar.get_x() + bar.get_width() / 2, height),
                    xytext=(0, 5 if height >= 0 else -15),
                    textcoords="offset points",
                    ha='center', va='bottom' if height >= 0 else 'top',
                    fontsize=14, fontweight='bold', color=color)
    
    # Add improvement annotation
    improvement = with_prot['netPnL'] - without['netPnL']
    improvement_pct = (improvement / data['config']['initialLPBalance']) * 100
    ax2.annotate(f'🛡️ +${improvement:,.0f}\n({improvement_pct:.1f}% of capital)',
                xy=(1.5, max(values) * 0.7),
                fontsize=12, ha='center',
                bbox=dict(boxstyle='round', facecolor='wheat', alpha=0.8))
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'comparison_chart.png'), dpi=150, bbox_inches='tight')
    plt.close()
    print('✅ Created: comparison_chart.png')

def create_protection_value_pie(data, output_dir):
    """Create pie chart showing sources of protection value."""
    fig, ax = plt.subplots(figsize=(10, 8))
    
    comp = data['comparison']
    
    labels = ['Higher Fees\n(Dynamic Pricing)', 'Adverse Selection\nReduction', 'Gap Auction\nGains']
    sizes = [
        max(0, comp['feeImprovement']),
        max(0, comp['adverseSelectionReduction']),
        max(0, comp['gapProtectionValue'])
    ]
    colors = ['#3498db', '#e74c3c', '#27ae60']
    explode = (0, 0.05, 0.1)
    
    total = sum(sizes)
    
    if total > 0:
        wedges, texts, autotexts = ax.pie(sizes, explode=explode, labels=labels, colors=colors,
                                          autopct=lambda p: f'${p*total/100:,.0f}\n({p:.1f}%)',
                                          shadow=True, startangle=90)
        autotexts[0].set_fontsize(10)
        autotexts[1].set_fontsize(10)
        autotexts[2].set_fontsize(10)
    
    ax.set_title(f'Sources of StockShield Protection Value\n(Total: ${total:,.0f})', 
                 fontsize=14, fontweight='bold')
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'protection_value_pie.png'), dpi=150, bbox_inches='tight')
    plt.close()
    print('✅ Created: protection_value_pie.png')

def create_trade_distribution_chart(data, output_dir):
    """Create charts showing trade distribution by type and regime."""
    fig, axes = plt.subplots(1, 2, figsize=(14, 5))
    
    trades = data['tradeData']
    
    # Left: Informed vs Retail trading volume
    ax1 = axes[0]
    informed_vol = sum(t['volume'] for t in trades if t['isInformed'])
    retail_vol = sum(t['volume'] for t in trades if not t['isInformed'])
    
    labels = ['Informed Traders', 'Retail Traders']
    sizes = [informed_vol, retail_vol]
    colors = ['#e74c3c', '#3498db']
    
    wedges, texts, autotexts = ax1.pie(sizes, labels=labels, colors=colors,
                                        autopct=lambda p: f'${p*sum(sizes)/100/1e6:.1f}M\n({p:.1f}%)',
                                        shadow=True, startangle=90)
    ax1.set_title('Trading Volume by Trader Type', fontsize=12, fontweight='bold')
    
    # Right: Buy vs Sell
    ax2 = axes[1]
    buy_vol = sum(t['volume'] for t in trades if t['isBuy'])
    sell_vol = sum(t['volume'] for t in trades if not t['isBuy'])
    
    labels = ['Buy Orders', 'Sell Orders']
    sizes = [buy_vol, sell_vol]
    colors = ['#27ae60', '#e74c3c']
    
    wedges, texts, autotexts = ax2.pie(sizes, labels=labels, colors=colors,
                                        autopct=lambda p: f'${p*sum(sizes)/100/1e6:.1f}M\n({p:.1f}%)',
                                        shadow=True, startangle=90)
    ax2.set_title('Trading Volume by Direction', fontsize=12, fontweight='bold')
    
    plt.tight_layout()
    plt.savefig(os.path.join(output_dir, 'trade_distribution.png'), dpi=150, bbox_inches='tight')
    plt.close()
    print('✅ Created: trade_distribution.png')

def main():
    """Generate all charts."""
    print('📊 StockShield Simulation Graph Generator\n')
    print('═' * 50)
    
    # Find data file
    script_dir = os.path.dirname(os.path.abspath(__file__))
    data_path = os.path.join(script_dir, 'simulation_results', 'simulation_data.json')
    
    if not os.path.exists(data_path):
        print(f'❌ Data file not found: {data_path}')
        print('   Run the simulation first: npx ts-node src/yellow/e2e-simulation.ts')
        return
    
    # Load data
    print(f'\n📂 Loading: {data_path}')
    data = load_data(data_path)
    print(f'   Config: {data["config"]["simulationDays"]} days, ${data["config"]["initialLPBalance"]:,} initial')
    
    # Create output directory
    output_dir = os.path.join(script_dir, 'simulation_results', 'graphs')
    os.makedirs(output_dir, exist_ok=True)
    
    # Generate charts
    print('\n📈 Generating charts...')
    create_price_chart(data, output_dir)
    create_vpin_chart(data, output_dir)
    create_comparison_chart(data, output_dir)
    create_protection_value_pie(data, output_dir)
    create_trade_distribution_chart(data, output_dir)
    
    print('\n' + '═' * 50)
    print(f'✅ All charts saved to: {output_dir}')
    print('═' * 50 + '\n')

if __name__ == '__main__':
    main()
