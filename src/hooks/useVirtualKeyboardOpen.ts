import { useEffect, useState } from 'react';

/**
 * Detects when an on-screen mobile virtual keyboard is open via visualViewport height ratio,
 * allowing fixed bottom navigation to step aside while typing Cyrillic text.
 */
export function useVirtualKeyboardOpen(): boolean {
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    let baselineHeight = Math.max(window.innerHeight, vv.height);

    const check = () => {
      if (window.innerWidth >= 1024) {
        setKeyboardOpen(false);
        return;
      }
      if (vv.height > baselineHeight) {
        baselineHeight = vv.height;
      }
      const isShrunk = vv.height < baselineHeight * 0.76;
      setKeyboardOpen(isShrunk);
    };

    const handleOrientation = () => {
      baselineHeight = window.innerHeight;
      setKeyboardOpen(false);
    };

    vv.addEventListener('resize', check);
    window.addEventListener('orientationchange', handleOrientation);
    return () => {
      vv.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', handleOrientation);
    };
  }, []);

  return keyboardOpen;
}
