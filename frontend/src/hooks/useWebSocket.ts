'use client';

/**
 * WebSocket Hook for Real-time Updates
 * 
 * Connects to the StockShield backend WebSocket server for live data.
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { WS_URL } from '@/lib/api';

// ============================================================================
// Types
// ============================================================================

export interface WSMessage {
    type: string;
    data: unknown;
    timestamp: number;
}

export interface VPINUpdate {
    poolId: string;
    vpin: number;
    bucketCount: number;
    level: string;
    trend: 'rising' | 'falling';
}

export interface RegimeChange {
    from: string;
    to: string;
    multiplier: number;
    riskLevel: string;
}

export interface PriceUpdate {
    asset: string;
    price: number;
    source: string;
    confidence: number;
}

export interface CircuitBreakerTrigger {
    level: number;
    flags: string[];
    previousLevel: number;
}

export interface UseWebSocketOptions {
    onVPINUpdate?: (data: VPINUpdate) => void;
    onRegimeChange?: (data: RegimeChange) => void;
    onPriceUpdate?: (data: PriceUpdate) => void;
    onCircuitBreaker?: (data: CircuitBreakerTrigger) => void;
    onConnected?: () => void;
    onDisconnected?: () => void;
    autoReconnect?: boolean;
    reconnectInterval?: number;
}

// ============================================================================
// Hook
// ============================================================================

export function useStockShieldWS(options: UseWebSocketOptions = {}) {
    const [isConnected, setIsConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState<WSMessage | null>(null);
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const {
        onVPINUpdate,
        onRegimeChange,
        onPriceUpdate,
        onCircuitBreaker,
        onConnected,
        onDisconnected,
        autoReconnect = true,
        reconnectInterval = 5000,
    } = options;

    const connect = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            return;
        }

        try {
            const ws = new WebSocket(WS_URL);
            wsRef.current = ws;

            ws.onopen = () => {
                setIsConnected(true);
                onConnected?.();

                // Subscribe to all channels
                ws.send(JSON.stringify({
                    type: 'subscribe',
                    channels: ['vpin', 'regime', 'price', 'circuitBreaker'],
                }));
            };

            ws.onmessage = (event) => {
                try {
                    const message: WSMessage = JSON.parse(event.data);
                    setLastMessage(message);

                    // Route to appropriate handler
                    switch (message.type) {
                        case 'vpin:update':
                            onVPINUpdate?.(message.data as VPINUpdate);
                            break;
                        case 'regime:change':
                            onRegimeChange?.(message.data as RegimeChange);
                            break;
                        case 'price:update':
                            onPriceUpdate?.(message.data as PriceUpdate);
                            break;
                        case 'circuitBreaker:trigger':
                            onCircuitBreaker?.(message.data as CircuitBreakerTrigger);
                            break;
                    }
                } catch (error) {
                    console.error('Failed to parse WebSocket message:', error);
                }
            };

            ws.onclose = () => {
                setIsConnected(false);
                onDisconnected?.();

                // Auto-reconnect
                if (autoReconnect) {
                    reconnectTimeoutRef.current = setTimeout(() => {
                        connect();
                    }, reconnectInterval);
                }
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };
        } catch (error) {
            console.error('Failed to connect to WebSocket:', error);
        }
    }, [onVPINUpdate, onRegimeChange, onPriceUpdate, onCircuitBreaker, onConnected, onDisconnected, autoReconnect, reconnectInterval]);

    const disconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
        }
        wsRef.current?.close();
    }, []);

    const send = useCallback((message: object) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(message));
        }
    }, []);

    // Connect on mount, disconnect on unmount
    useEffect(() => {
        connect();
        return () => {
            disconnect();
        };
    }, [connect, disconnect]);

    return {
        isConnected,
        lastMessage,
        send,
        connect,
        disconnect,
    };
}
