import { useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';

/**
 * Socket.io endpoint.
 *
 * - Production: same-origin via the nginx `location /messaging/` proxy.
 * - Development: the Vite dev server (5173) does not proxy websockets, so
 *   connect straight to the NestJS backend on 3002.
 */
const WS_URL =
  typeof window !== 'undefined' && window.location.protocol === 'https:'
    ? `${window.location.origin}/messaging`
    : 'http://localhost:3002/messaging';

/**
 * Hook to connect to the OpenEMR WebSocket messaging gateway.
 * Provides real-time event subscription for messages, notifications,
 * and domain events.
 */
export function useMessagingSocket(options?: {
  topics?: string[];
  onEvent?: (event: MessagingEvent) => void;
  onNewMessage?: (event: MessagingEvent) => void;
  onNotification?: (event: MessagingEvent) => void;
  onConnected?: () => void;
}) {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = io(WS_URL, {
      path: '/messaging/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 10,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('[WS] Connected:', socket.id);

      // Subscribe to requested topics
      if (options?.topics && options.topics.length > 0) {
        socket.emit('subscribe', { topics: options.topics });
      }

      options?.onConnected?.();
    });

    socket.on('connected', (data) => {
      console.log('[WS] Welcome:', data);
    });

    socket.on('event', (event: MessagingEvent) => {
      options?.onEvent?.(event);
    });

    socket.on('new_message', (event: MessagingEvent) => {
      options?.onNewMessage?.(event);
    });

    socket.on('notification', (event: MessagingEvent) => {
      options?.onNotification?.(event);
    });

    socket.on('disconnect', (reason) => {
      console.log('[WS] Disconnected:', reason);
    });

    socket.on('connect_error', (err) => {
      console.warn('[WS] Connection error:', err.message);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Subscribe to additional topics after connection */
  const subscribe = useCallback((topics: string[]) => {
    socketRef.current?.emit('subscribe', { topics });
  }, []);

  /** Unsubscribe from topics */
  const unsubscribe = useCallback((topics: string[]) => {
    socketRef.current?.emit('unsubscribe', { topics });
  }, []);

  /** Identify the current user */
  const identify = useCallback((userId: number) => {
    socketRef.current?.emit('identify', { userId });
  }, []);

  return { subscribe, unsubscribe, identify };
}

export interface MessagingEvent {
  topic: string;
  eventId: string;
  type: 'message' | 'appointment' | 'patient' | 'clinical' | 'notification' | 'audit' | 'direct';
  priority: 'STAT' | 'URGENT' | 'HIGH' | 'NORMAL' | 'LOW';
  timestamp: string;
  payload: {
    title?: string;
    body?: string;
    pid?: number;
    action?: string;
    entityId?: number;
    messageType?: string;
    [key: string]: any;
  };
}
