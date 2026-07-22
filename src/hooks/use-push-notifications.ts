/**
 * usePushNotifications — React hook for managing push notification subscriptions.
 *
 * Handles:
 * - Service worker registration
 * - Push subscription (subscribe / unsubscribe)
 * - Permission state tracking
 * - Automatic re-subscription on login
 * - Cleanup on logout
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

// Public VAPID key — must be set as VITE_VAPID_PUBLIC_KEY in .env
const VAPID_PUBLIC_KEY =
  import.meta.env.VITE_VAPID_PUBLIC_KEY || "";

// SW is registered by main.tsx on startup; usePushNotifications uses
// navigator.serviceWorker.ready to get the existing registration.

export type NotificationStatus = "unsupported" | "denied" | "granted" | "prompt" | "loading";

interface PushNotificationState {
  /** Current permission / subscription status */
  status: NotificationStatus;
  /** Whether the user has subscribed for push notifications */
  isSubscribed: boolean;
  /** Whether the service worker is registered */
  isSwRegistered: boolean;
  /** Loading state for subscribe/unsubscribe operations */
  isLoading: boolean;
  /** Error message if something went wrong */
  error: string | null;
}

export function usePushNotifications() {
  const [state, setState] = useState<PushNotificationState>({
    status: "unsupported",
    isSubscribed: false,
    isSwRegistered: false,
    isLoading: true,
    error: null,
  });

  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const isSubscribedRef = useRef(false);

  // -----------------------------------------------------------------------
  // Helper to update status
  // -----------------------------------------------------------------------
  const updateState = useCallback((partial: Partial<PushNotificationState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  // -----------------------------------------------------------------------
  // Check if push is supported
  // -----------------------------------------------------------------------
  const isPushSupported = (): boolean => {
    return "serviceWorker" in navigator && "PushManager" in window;
  };

  // -----------------------------------------------------------------------
  // Base64 URL-safe decoder for VAPID key
  // The public key from VAPID is base64 URL-safe encoded.
  // The PushManager expects a Uint8Array.
  // -----------------------------------------------------------------------
  function urlBase64ToUint8Array(base64String: string): Uint8Array {
    const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding)
      .replace(/-/g, "+")
      .replace(/_/g, "/");

    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);

    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }

  // -----------------------------------------------------------------------
  // Get the active ServiceWorkerRegistration (registered by main.tsx on boot)
  // -----------------------------------------------------------------------
  const getServiceWorkerRegistration = useCallback(async (): Promise<ServiceWorkerRegistration | null> => {
    if (!isPushSupported()) {
      updateState({ isLoading: false, status: "unsupported" });
      return null;
    }

    try {
      // navigator.serviceWorker.ready resolves once the SW is active (no redundant register call)
      const registration = await navigator.serviceWorker.ready;
      swRegistrationRef.current = registration;
      updateState({ isSwRegistered: true });
      return registration;
    } catch (err) {
      console.error("[PUSH] SW ready failed:", err);
      updateState({
        isLoading: false,
        error: "Falha ao obter service worker.",
      });
      return null;
    }
  }, [updateState]);

  // -----------------------------------------------------------------------
  // Get the current subscription from the SW registration
  // -----------------------------------------------------------------------
  const getSubscription = useCallback(async (): Promise<PushSubscription | null> => {
    if (!swRegistrationRef.current) return null;
    try {
      return await swRegistrationRef.current.pushManager.getSubscription();
    } catch {
      return null;
    }
  }, []);

  // -----------------------------------------------------------------------
  // Subscribe to push notifications
  // -----------------------------------------------------------------------
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!isPushSupported()) {
      updateState({ error: "Notifica\u00e7\u00f5es push n\u00e3o s\u00e3o suportadas neste navegador." });
      return false;
    }

    if (!VAPID_PUBLIC_KEY) {
      updateState({ error: "Chave VAPID p\u00fablica n\u00e3o configurada." });
      return false;
    }

    try {
      updateState({ isLoading: true, error: null });

      // Request permission if needed
      const permission = await Notification.requestPermission();
      if (permission === "denied") {
        updateState({
          status: "denied",
          isSubscribed: false,
          isLoading: false,
          error: "Notifica\u00e7\u00f5es foram bloqueadas. Permita nas configura\u00e7\u00f5es do navegador.",
        });
        return false;
      }

      if (permission === "granted") {
        updateState({ status: "granted" });
      } else {
        updateState({ status: "prompt", isLoading: false });
        return false;
      }

      // Get SW registration (registered by main.tsx on page load)
      let registration = swRegistrationRef.current;
      if (!registration) {
        registration = await getServiceWorkerRegistration();
        if (!registration) {
          updateState({ isLoading: false });
          return false;
        }
      }

      // Subscribe to push
      const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource,
      });

      // Send subscription to the server
      const subJSON = subscription.toJSON();

      if (!subJSON.endpoint || !subJSON.keys) {
        throw new Error("Subscription object is invalid");
      }

      const response = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          endpoint: subJSON.endpoint,
          keys: subJSON.keys,
          userAgent: navigator.userAgent,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Erro ao salvar inscri\u00e7\u00e3o push");
      }

      isSubscribedRef.current = true;
      updateState({ isSubscribed: true, isLoading: false, error: null });

      return true;
    } catch (err: any) {
      console.error("[PUSH] Subscribe error:", err);
      updateState({
        isLoading: false,
        error: err.message || "Erro ao ativar notifica\u00e7\u00f5es push.",
      });
      return false;
    }
  }, [updateState]);

  // -----------------------------------------------------------------------
  // Unsubscribe from push notifications
  // -----------------------------------------------------------------------
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    try {
      updateState({ isLoading: true, error: null });

      const subscription = await getSubscription();
      if (subscription) {
        // Unsubscribe from push service
        await subscription.unsubscribe();

        // Remove from server
        const subJSON = subscription.toJSON();
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            endpoint: subJSON.endpoint || "",
          }),
        });
      }

      isSubscribedRef.current = false;
      updateState({ isSubscribed: false, isLoading: false, error: null });

      return true;
    } catch (err: any) {
      console.error("[PUSH] Unsubscribe error:", err);
      updateState({
        isLoading: false,
        error: err.message || "Erro ao desativar notifica\u00e7\u00f5es push.",
      });
      return false;
    }
  }, [updateState, getSubscription]);

  // -----------------------------------------------------------------------
  // Toggle subscription on/off
  // -----------------------------------------------------------------------
  const toggleSubscription = useCallback(async () => {
    if (state.isSubscribed) {
      return await unsubscribe();
    } else {
      return await subscribe();
    }
  }, [state.isSubscribed, subscribe, unsubscribe]);

  // -----------------------------------------------------------------------
  // Initialize — check initial state on mount
  // -----------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (!isPushSupported()) {
        if (!cancelled) updateState({ isLoading: false, status: "unsupported" });
        return;
      }

      // Check permission
      if (Notification.permission === "denied") {
        if (!cancelled) updateState({ isLoading: false, status: "denied", isSubscribed: false });
        return;
      }

      if (Notification.permission === "granted") {
        if (!cancelled) updateState({ status: "granted" });
      } else {
        if (!cancelled) updateState({ status: "prompt", isLoading: false });
        return;
      }

      // Try to get existing subscription (SW already registered by main.tsx)
      try {
        const registration = await getServiceWorkerRegistration();
        if (!registration || cancelled) {
          if (!cancelled) updateState({ isLoading: false });
          return;
        }

        const subscription = await registration.pushManager.getSubscription();
        if (subscription && !cancelled) {
          isSubscribedRef.current = true;
          updateState({ isSubscribed: true, isLoading: false });
        } else if (!cancelled) {
          updateState({ isSubscribed: false, isLoading: false });
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[PUSH] Init error:", err);
          updateState({ isLoading: false });
        }
      }
    };

    init();

    return () => {
      cancelled = true;
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    ...state,
    subscribe,
    unsubscribe,
    toggleSubscription,
    isSupported: isPushSupported(),
  };
}

  // -----------------------------------------------------------------------
  // Toggle subscription on/off
  // -----------------------------------------------------------------------
  const toggleSubscription = useCallback(async () => {
    if (state.isSubscribed) {
      return await unsubscribe();
    } else {
      return await subscribe();
    }
  }, [state.isSubscribed, subscribe, unsubscribe]);

  // -----------------------------------------------------------------------
  // Initialize — check initial state on mount
  // -----------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      if (!isPushSupported()) {
        if (!cancelled) updateState({ isLoading: false, status: "unsupported" });
        return;
      }

      // Check permission
      if (Notification.permission === "denied") {
        if (!cancelled) updateState({ isLoading: false, status: "denied", isSubscribed: false });
        return;
      }

      if (Notification.permission === "granted") {
        if (!cancelled) updateState({ status: "granted" });
      } else {
        if (!cancelled) updateState({ status: "prompt", isLoading: false });
        return;
      }

      // Try to get existing subscription (SW already registered by main.tsx)
      try {
        const registration = await getServiceWorkerRegistration();
        if (!registration || cancelled) {
          if (!cancelled) updateState({ isLoading: false });
          return;
        }

        const subscription = await registration.pushManager.getSubscription();
        if (subscription && !cancelled) {
          isSubscribedRef.current = true;
          updateState({ isSubscribed: true, isLoading: false });
        } else if (!cancelled) {
          updateState({ isSubscribed: false, isLoading: false });
        }
      } catch (err) {
        if (!cancelled) {
          console.error("[PUSH] Init error:", err);
          updateState({ isLoading: false });
        }
      }
    };

    init();

    return () => {
      cancelled = true;
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    ...state,
    subscribe,
    unsubscribe,
    toggleSubscription,
    isSupported: isPushSupported(),
  };
}
