import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBaseUrl } from "@/constants/oauth";
import { getSessionToken } from "@/lib/_core/auth";

export type ChatMessage = { id: string; senderId: string; text: string; timestamp: number };
export type ChatConnectionState = "idle" | "connecting" | "open" | "error";

type ServerMessage = {
  id: number | string;
  senderId: string;
  text: string;
  sentAt: string | number;
};

type Sender = {
  id: string;
  name: string;
  role?: string;
};

function toMessage(message: ServerMessage): ChatMessage {
  return {
    id: String(message.id),
    senderId: String(message.senderId),
    text: message.text,
    timestamp: typeof message.sentAt === "number" ? message.sentAt : new Date(message.sentAt).getTime(),
  };
}

/**
 * Uses the application's Nest chat API instead of requiring an optional
 * Supabase project. Polling keeps the feature available on Expo native and web.
 */
export function useChatRealtime(channel: string | null, sender: Sender | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [connectionState, setConnectionState] = useState<ChatConnectionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const latestId = useRef<string | null>(null);

  const loadMessages = useCallback(async () => {
    if (!channel) return;
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) throw new Error("Healthcare API server is not configured.");

    const token = await getSessionToken();
    const response = await fetch(
      `${baseUrl}/api/chat/messages?channel=${encodeURIComponent(channel)}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : undefined },
    );
    if (!response.ok) throw new Error("Unable to load this conversation.");

    const data = (await response.json()) as ServerMessage[];
    const next = data.map(toMessage);
    latestId.current = next.at(-1)?.id ?? null;
    setMessages(next);
  }, [channel]);

  useEffect(() => {
    let cancelled = false;
    setMessages([]);
    setLoaded(false);
    setError(null);
    latestId.current = null;
    if (!channel) {
      setConnectionState("idle");
      return undefined;
    }

    const refresh = async () => {
      setConnectionState("connecting");
      try {
        await loadMessages();
        if (!cancelled) {
          setConnectionState("open");
          setLoaded(true);
        }
      } catch (cause) {
        if (!cancelled) {
          setConnectionState("error");
          setLoaded(true);
          setError(cause instanceof Error ? cause.message : "Unable to load this conversation.");
        }
      }
    };

    void refresh();
    const interval = setInterval(() => void refresh(), 3_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [channel, loadMessages]);

  const send = useCallback(async (text: string) => {
    const content = text.trim();
    if (!channel || !sender || !content) return;
    const baseUrl = getApiBaseUrl();
    if (!baseUrl) throw new Error("Healthcare API server is not configured.");
    const token = await getSessionToken();
    const response = await fetch(`${baseUrl}/api/chat/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        channel,
        senderId: sender.id,
        senderName: sender.name,
        senderRole: sender.role,
        senderInitials: sender.name.slice(0, 2).toUpperCase(),
        text: content,
      }),
    });
    if (!response.ok) throw new Error("Message could not be sent.");
    const saved = toMessage((await response.json()) as ServerMessage);
    setMessages((current) => current.some((message) => message.id === saved.id) ? current : [...current, saved]);
    latestId.current = saved.id;
  }, [channel, sender]);

  return { messages, loaded, connectionState, error, unreadCount: 0, send };
}
