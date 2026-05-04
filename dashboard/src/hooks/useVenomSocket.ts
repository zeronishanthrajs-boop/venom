"use client";

import { useEffect, useRef, useState } from "react";

import type { VenomSession } from "@/lib/session";
import { fetchRealtimeToken } from "@/lib/api";

export type VenomSocketEvent =
  | "realtime_connected"
  | "tool_result"
  | "new_finding"
  | "research_update"
  | "orchestration_state"
  | "orchestration_step";

type VenomSocketMessage = {
  event: VenomSocketEvent;
  data?: unknown;
  timestamp?: string;
};

type EventHandlerMap = Partial<
  Record<VenomSocketEvent, (payload: VenomSocketMessage) => void>
>;

function getSocketBaseUrl() {
  const base = process.env.NEXT_PUBLIC_VENOM_API_BASE_URL?.trim();
  if (!base) {
    return null;
  }
  return base.replace(/^http:/i, "ws:").replace(/^https:/i, "wss:");
}

export function useVenomSocket(
  session: VenomSession | null,
  engagementId: string | null,
  handlers: EventHandlerMap
) {
  const socketRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const closedByUserRef = useRef(false);
  const handlersRef = useRef(handlers);
  const [connected, setConnected] = useState(false);
  const [lastEventAt, setLastEventAt] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  useEffect(() => {
    if (!session || !engagementId) {
      return;
    }

    const wsBase = getSocketBaseUrl();
    if (!wsBase) {
      return;
    }

    let active = true;
    closedByUserRef.current = false;

    const cleanupSocket = () => {
      if (socketRef.current) {
        try {
          socketRef.current.close();
        } catch {
          // no-op
        }
        socketRef.current = null;
      }
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
    };

    const connect = async () => {
      try {
        const tokenPayload = await fetchRealtimeToken(session, engagementId);
        if (!active) {
          return;
        }

        const query = new URLSearchParams({
          token: tokenPayload.token,
          engagementId
        });
        const socketUrl = `${wsBase}${tokenPayload.wsPath}?${query.toString()}`;
        const socket = new WebSocket(socketUrl);
        socketRef.current = socket;

        socket.onopen = () => {
          if (!active) {
            return;
          }
          setConnected(true);
          setLastError(null);
        };

        socket.onmessage = (event) => {
          if (!active) {
            return;
          }
          try {
            const payload = JSON.parse(String(event.data || "{}")) as VenomSocketMessage;
            setLastEventAt(payload.timestamp || new Date().toISOString());
            const eventName = payload.event;
            if (eventName && handlersRef.current[eventName]) {
              handlersRef.current[eventName]?.(payload);
            }
          } catch {
            // ignore malformed socket messages
          }
        };

        socket.onerror = () => {
          if (!active) {
            return;
          }
          setLastError("Realtime socket encountered an error.");
        };

        socket.onclose = () => {
          if (!active) {
            return;
          }
          setConnected(false);
          if (closedByUserRef.current) {
            return;
          }
          reconnectTimerRef.current = window.setTimeout(() => {
            void connect();
          }, 3000);
        };
      } catch (error) {
        if (!active) {
          return;
        }
        const message =
          error instanceof Error ? error.message : "Failed to initialize realtime socket.";
        setLastError(message);
        reconnectTimerRef.current = window.setTimeout(() => {
          void connect();
        }, 5000);
      }
    };

    void connect();

    return () => {
      active = false;
      closedByUserRef.current = true;
      cleanupSocket();
    };
  }, [session, engagementId]);

  const configurationError =
    session && engagementId && !getSocketBaseUrl()
      ? "Realtime socket disabled: NEXT_PUBLIC_VENOM_API_BASE_URL is not set."
      : null;

  return {
    connected,
    lastEventAt,
    lastError: configurationError || lastError
  };
}
