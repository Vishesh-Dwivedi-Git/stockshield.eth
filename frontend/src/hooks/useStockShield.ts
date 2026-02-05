'use client';

/**
 * StockShield API Hooks
 * 
 * React hooks for fetching data from the StockShield backend.
 */

import { useState, useEffect, useCallback } from 'react';
import {
    api,
    RegimeResponse,
    VPINResponse,
    PriceResponse,
    FeeResponse,
    PoolsResponse,
    CircuitBreakerResponse,
    AuctionsResponse
} from '@/lib/api';

// ============================================================================
// Generic Fetch Hook
// ============================================================================

interface UseFetchState<T> {
    data: T | null;
    isLoading: boolean;
    error: Error | null;
    refetch: () => void;
}

function useFetch<T>(
    fetcher: () => Promise<T>,
    deps: unknown[] = [],
    pollInterval?: number
): UseFetchState<T> {
    const [data, setData] = useState<T | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<Error | null>(null);

    const fetch = useCallback(async () => {
        try {
            setIsLoading(true);
            setError(null);
            const result = await fetcher();
            setData(result);
        } catch (err) {
            setError(err instanceof Error ? err : new Error('Unknown error'));
        } finally {
            setIsLoading(false);
        }
    }, [fetcher]);

    useEffect(() => {
        fetch();

        if (pollInterval) {
            const interval = setInterval(fetch, pollInterval);
            return () => clearInterval(interval);
        }
    }, [...deps, fetch, pollInterval]);

    return { data, isLoading, error, refetch: fetch };
}

// ============================================================================
// Specific Hooks
// ============================================================================

/**
 * Hook for current market regime
 */
export function useRegime(pollInterval: number = 30000) {
    return useFetch<RegimeResponse>(() => api.getRegime(), [], pollInterval);
}

/**
 * Hook for VPIN score
 */
export function useVPIN(poolId: string, pollInterval: number = 5000) {
    return useFetch<VPINResponse>(() => api.getVPIN(poolId), [poolId], pollInterval);
}

/**
 * Hook for oracle price
 */
export function usePrice(asset: string, pollInterval: number = 10000) {
    return useFetch<PriceResponse>(() => api.getPrice(asset), [asset], pollInterval);
}

/**
 * Hook for dynamic fee
 */
export function useFee(poolId: string, pollInterval: number = 5000) {
    return useFetch<FeeResponse>(() => api.getFees(poolId), [poolId], pollInterval);
}

/**
 * Hook for all pools
 */
export function usePools(pollInterval: number = 30000) {
    return useFetch<PoolsResponse>(() => api.getPools(), [], pollInterval);
}

/**
 * Hook for circuit breaker status
 */
export function useCircuitBreaker(pollInterval: number = 10000) {
    return useFetch<CircuitBreakerResponse>(() => api.getCircuitBreaker(), [], pollInterval);
}

/**
 * Hook for active auctions
 */
export function useActiveAuctions(pollInterval: number = 5000) {
    return useFetch<AuctionsResponse>(() => api.getActiveAuctions(), [], pollInterval);
}

/**
 * Hook for checking API health
 */
export function useHealth() {
    return useFetch(() => api.getHealth(), [], 60000);
}

// ============================================================================
// Combined Hook for Dashboard
// ============================================================================

export interface DashboardData {
    regime: RegimeResponse | null;
    vpin: VPINResponse | null;
    circuitBreaker: CircuitBreakerResponse | null;
    pools: PoolsResponse | null;
    isLoading: boolean;
    error: Error | null;
}

export function useDashboard(poolId: string = '0xdefault'): DashboardData {
    const regime = useRegime();
    const vpin = useVPIN(poolId);
    const circuitBreaker = useCircuitBreaker();
    const pools = usePools();

    return {
        regime: regime.data,
        vpin: vpin.data,
        circuitBreaker: circuitBreaker.data,
        pools: pools.data,
        isLoading: regime.isLoading || vpin.isLoading || circuitBreaker.isLoading || pools.isLoading,
        error: regime.error || vpin.error || circuitBreaker.error || pools.error,
    };
}
