/**
 * Update Notification — Detects new deployments and prompts the user to reload.
 *
 * How it works:
 * 1. Registers a message listener on the Service Worker.
 * 2. When the SW detects a new version (via /api/version check), it sends
 *    a "NEW_VERSION" message to all clients.
 * 3. This component receives that message and shows a toast with a reload button.
 * 4. The SW also checks for updates every 5 minutes automatically.
 * 5. On first load, it also triggers an immediate update check.
 */

import { useEffect, useRef } from "react";
import { toast } from "sonner";

export function UpdateNotification() {
  const hasNotifiedRef = useRef(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    // Listen for messages from the Service Worker
    const messageHandler = (event: MessageEvent) => {
      if (event.data?.type === "NEW_VERSION" && !hasNotifiedRef.current) {
        hasNotifiedRef.current = true;
        showUpdateToast();
      }
    };

    navigator.serviceWorker.addEventListener("message", messageHandler);

    // Trigger an immediate update check when the app loads
    checkForUpdate();

    // Check for updates every 5 minutes
    const interval = setInterval(checkForUpdate, 5 * 60 * 1000);

    return () => {
      navigator.serviceWorker.removeEventListener("message", messageHandler);
      clearInterval(interval);
    };
  }, []);

  return null; // This component doesn't render anything
}

function checkForUpdate() {
  if (!navigator.serviceWorker?.controller) return;
  navigator.serviceWorker.controller.postMessage({ type: "CHECK_UPDATE" });
}

function showUpdateToast() {
  toast.info("Nova versão disponível!", {
    description: "Recarregue para atualizar o aplicativo.",
    duration: 30_000, // Show for 30 seconds
    action: {
      label: "Atualizar",
      onClick: () => {
        // Tell the SW to skip waiting, then reload
        navigator.serviceWorker?.controller?.postMessage({ type: "SKIP_WAITING" });
        // Small delay to let the SW activate
        setTimeout(() => window.location.reload(), 300);
      },
    },
    cancel: {
      label: "Agora não",
      onClick: () => {}, // Just dismiss
    },
  });
}
