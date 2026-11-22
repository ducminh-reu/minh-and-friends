import { useEffect, useRef, useState } from 'react';
import { registerSW } from 'virtual:pwa-register';

export function usePwaConnectivity() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  const [swRegistered, setSwRegistered] = useState(false);
  const [swUpdateAvailable, setSwUpdateAvailable] = useState(false);
  const updateFnRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    if ('serviceWorker' in navigator) {
      const updateSW = registerSW({
        immediate: true,
        onRegisteredSW(_swUrl, registration) {
          if (registration) {
            setSwRegistered(true);
          }
        },
        onNeedRefresh() {
          setSwUpdateAvailable(true);
        },
        onOfflineReady() {
          setSwRegistered(true);
        },
      });
      updateFnRef.current = updateSW;
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const applySwUpdate = async () => {
    if (updateFnRef.current) {
      await updateFnRef.current(true);
    } else {
      window.location.reload();
    }
  };

  return {
    isOnline,
    swRegistered,
    swUpdateAvailable,
    applySwUpdate,
  };
}
