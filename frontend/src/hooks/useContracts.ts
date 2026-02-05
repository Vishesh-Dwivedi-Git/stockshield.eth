'use client';

/**
 * Contract Interaction Hooks
 * 
 * React hooks for interacting with StockShield smart contracts.
 * Currently using stub ABIs since contracts are not fully deployed.
 */

import { useState, useCallback } from 'react';
import { useAccount, useWriteContract, useReadContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther, formatEther } from 'viem';

// ============================================================================
// Contract Addresses (Stub - update when deployed)
// ============================================================================

const CONTRACTS = {
    marginVault: process.env.NEXT_PUBLIC_MARGIN_VAULT_ADDRESS as `0x${string}` || '0x0000000000000000000000000000000000000000',
    gapAuction: process.env.NEXT_PUBLIC_GAP_AUCTION_ADDRESS as `0x${string}` || '0x0000000000000000000000000000000000000000',
    stockShieldHook: process.env.NEXT_PUBLIC_HOOK_ADDRESS as `0x${string}` || '0x0000000000000000000000000000000000000000',
    regimeOracle: process.env.NEXT_PUBLIC_REGIME_ORACLE_ADDRESS as `0x${string}` || '0x0000000000000000000000000000000000000000',
    resolver: process.env.NEXT_PUBLIC_RESOLVER_ADDRESS as `0x${string}` || '0x0000000000000000000000000000000000000000',
};

// ============================================================================
// Stub ABIs (Minimal interfaces for frontend development)
// ============================================================================

const MARGIN_VAULT_ABI = [
    {
        name: 'deposit',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'amount', type: 'uint256' }],
        outputs: [],
    },
    {
        name: 'withdraw',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'amount', type: 'uint256' }],
        outputs: [],
    },
    {
        name: 'vaults',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'owner', type: 'address' }],
        outputs: [
            { name: 'owner', type: 'address' },
            { name: 'collateral', type: 'uint256' },
            { name: 'ensNode', type: 'bytes32' },
            { name: 'activeChannelId', type: 'bytes32' },
            { name: 'locked', type: 'bool' },
        ],
    },
] as const;

const GAP_AUCTION_ABI = [
    {
        name: 'commit',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'auctionId', type: 'bytes32' },
            { name: 'bidHash', type: 'bytes32' },
        ],
        outputs: [],
    },
    {
        name: 'reveal',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
            { name: 'auctionId', type: 'bytes32' },
            { name: 'bid', type: 'uint256' },
            { name: 'salt', type: 'bytes32' },
        ],
        outputs: [],
    },
    {
        name: 'getAuction',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'auctionId', type: 'bytes32' }],
        outputs: [
            { name: 'poolId', type: 'bytes32' },
            { name: 'phase', type: 'uint8' },
            { name: 'commitEndTime', type: 'uint256' },
            { name: 'revealEndTime', type: 'uint256' },
            { name: 'highestBid', type: 'uint256' },
            { name: 'highestBidder', type: 'address' },
        ],
    },
] as const;

const RESOLVER_ABI = [
    {
        name: 'getReputation',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'trader', type: 'address' }],
        outputs: [
            { name: 'score', type: 'uint256' },
            { name: 'totalTrades', type: 'uint256' },
            { name: 'toxicTrades', type: 'uint256' },
        ],
    },
] as const;

// ============================================================================
// Hooks
// ============================================================================

/**
 * Hook for depositing to MarginVault
 */
export function useVaultDeposit() {
    const { address } = useAccount();
    const { writeContract, data: hash, isPending, error } = useWriteContract();
    const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

    const deposit = useCallback(async (amount: string) => {
        if (!address) throw new Error('Wallet not connected');

        writeContract({
            address: CONTRACTS.marginVault,
            abi: MARGIN_VAULT_ABI,
            functionName: 'deposit',
            args: [parseEther(amount)],
        });
    }, [address, writeContract]);

    return {
        deposit,
        isPending,
        isConfirming,
        isSuccess,
        error,
        hash,
    };
}

/**
 * Hook for withdrawing from MarginVault
 */
export function useVaultWithdraw() {
    const { address } = useAccount();
    const { writeContract, data: hash, isPending, error } = useWriteContract();
    const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

    const withdraw = useCallback(async (amount: string) => {
        if (!address) throw new Error('Wallet not connected');

        writeContract({
            address: CONTRACTS.marginVault,
            abi: MARGIN_VAULT_ABI,
            functionName: 'withdraw',
            args: [parseEther(amount)],
        });
    }, [address, writeContract]);

    return {
        withdraw,
        isPending,
        isConfirming,
        isSuccess,
        error,
        hash,
    };
}

/**
 * Hook for reading vault balance
 */
export function useVaultBalance() {
    const { address } = useAccount();

    const { data, isLoading, error, refetch } = useReadContract({
        address: CONTRACTS.marginVault,
        abi: MARGIN_VAULT_ABI,
        functionName: 'vaults',
        args: address ? [address] : undefined,
        query: {
            enabled: !!address && CONTRACTS.marginVault !== '0x0000000000000000000000000000000000000000',
        },
    });

    // Parse vault data
    const vault = data ? {
        owner: data[0],
        collateral: formatEther(data[1]),
        ensNode: data[2],
        activeChannelId: data[3],
        locked: data[4],
    } : null;

    return {
        vault,
        isLoading,
        error,
        refetch,
    };
}

/**
 * Hook for submitting gap auction bid
 */
export function useAuctionBid() {
    const { address } = useAccount();
    const { writeContract, data: hash, isPending, error } = useWriteContract();
    const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash });

    const commit = useCallback(async (auctionId: `0x${string}`, bidHash: `0x${string}`) => {
        if (!address) throw new Error('Wallet not connected');

        writeContract({
            address: CONTRACTS.gapAuction,
            abi: GAP_AUCTION_ABI,
            functionName: 'commit',
            args: [auctionId, bidHash],
        });
    }, [address, writeContract]);

    const reveal = useCallback(async (auctionId: `0x${string}`, bid: bigint, salt: `0x${string}`) => {
        if (!address) throw new Error('Wallet not connected');

        writeContract({
            address: CONTRACTS.gapAuction,
            abi: GAP_AUCTION_ABI,
            functionName: 'reveal',
            args: [auctionId, bid, salt],
        });
    }, [address, writeContract]);

    return {
        commit,
        reveal,
        isPending,
        isConfirming,
        isSuccess,
        error,
        hash,
    };
}

/**
 * Hook for reading trader reputation
 */
export function useReputation(traderAddress?: `0x${string}`) {
    const { address } = useAccount();
    const targetAddress = traderAddress || address;

    const { data, isLoading, error, refetch } = useReadContract({
        address: CONTRACTS.resolver,
        abi: RESOLVER_ABI,
        functionName: 'getReputation',
        args: targetAddress ? [targetAddress] : undefined,
        query: {
            enabled: !!targetAddress && CONTRACTS.resolver !== '0x0000000000000000000000000000000000000000',
        },
    });

    // Parse reputation data
    const reputation = data ? {
        score: Number(data[0]) / 1e18,
        totalTrades: Number(data[1]),
        toxicTrades: Number(data[2]),
        tier: getReputationTier(Number(data[0]) / 1e18),
    } : null;

    return {
        reputation,
        isLoading,
        error,
        refetch,
    };
}

// ============================================================================
// Helpers
// ============================================================================

function getReputationTier(score: number): 'platinum' | 'gold' | 'silver' | 'bronze' | 'restricted' {
    if (score >= 0.8) return 'platinum';
    if (score >= 0.6) return 'gold';
    if (score >= 0.4) return 'silver';
    if (score >= 0.2) return 'bronze';
    return 'restricted';
}

// Export contract addresses for reference
export { CONTRACTS };
