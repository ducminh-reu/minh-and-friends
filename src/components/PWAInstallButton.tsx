import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Share, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'sidebar' | 'card';
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ variant = 'compact' }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    if (variant === 'card') {
      return (
        <div className="text-xs font-medium text-[#165B52] bg-[#F2F9F8] border border-[#1F7A6E]/30 rounded-lg px-3 py-2">
          Ứng dụng đang chạy ở chế độ cài đặt độc lập (Standalone PWA).
        </div>
      );
    }
    return null;
  }

  const handleAction = async () => {
    if (isInstallable) {
      await install();
    } else if (isIOS) {
      setShowIOSGuide(true);
    }
  };

  const canShowAction = isInstallable || isIOS;

  if (!canShowAction) {
    if (variant === 'card') {
      return (
        <p className="text-xs text-slate-600 leading-relaxed">
          Mở trên Chrome (Android/Desktop) hoặc Safari (iPhone/iPad) để cài đặt <strong>RussianDict</strong> ra màn hình chính như ứng dụng gốc.
        </p>
      );
    }
    return null;
  }

  return (
    <>
      {variant === 'sidebar' && (
        <button
          type="button"
          onClick={handleAction}
          className="w-full flex items-center justify-center gap-2 px-3 py-2.5 min-h-[44px] rounded-lg bg-white/10 hover:bg-white/16 text-white text-xs font-semibold transition-colors"
        >
          <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{isIOS ? 'Cài lên iPhone / iPad' : 'Cài đặt ứng dụng'}</span>
        </button>
      )}

      {variant === 'compact' && (
        <button
          type="button"
          onClick={handleAction}
          aria-label={isIOS ? 'Hướng dẫn cài ứng dụng lên iOS' : 'Cài đặt ứng dụng PWA'}
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[44px] rounded-lg border border-slate-200 bg-white text-xs font-semibold text-[#0F2342] hover:bg-slate-50 transition-colors whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Cài app</span>
        </button>
      )}

      {variant === 'card' && (
        <button
          type="button"
          onClick={handleAction}
          className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-xs font-semibold hover:bg-[#163059] transition-colors"
        >
          <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{isIOS ? 'Hướng dẫn cài lên Màn hình chính (iOS)' : 'Cài đặt Russian Dictation (PWA)'}</span>
        </button>
      )}

      {showIOSGuide &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center bg-slate-900/50 p-4"
            onClick={() => setShowIOSGuide(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="ios-pwa-title"
              className="w-full max-w-sm max-h-[90vh] overflow-y-auto rounded-2xl bg-white border border-slate-200 p-5 shadow-xl space-y-4 safe-bottom"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 id="ios-pwa-title" className="text-base font-bold text-[#0F2342]">
                    Cài RussianDict trên iPhone / iPad
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    Safari hỗ trợ chạy toàn màn hình không thanh địa chỉ.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  aria-label="Đóng hướng dẫn"
                  className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <ol className="space-y-3 text-sm text-slate-700">
                <li className="flex items-start gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#F2F6FC] text-[#0F2342] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    1
                  </span>
                  <span>
                    Nhấn biểu tượng <strong className="inline-flex items-center gap-1 text-[#0F2342]">Chia sẻ <Share className="w-3.5 h-3.5" aria-hidden="true" /></strong> ở thanh công cụ Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#F2F6FC] text-[#0F2342] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    2
                  </span>
                  <span>
                    Cuộn xuống và chọn <strong className="text-[#0F2342]">Thêm vào Màn hình chính (Add to Home Screen)</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="w-6 h-6 rounded-full bg-[#F2F6FC] text-[#0F2342] text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                    3
                  </span>
                  <span>
                    Nhấn <strong className="text-[#0F2342]">Thêm (Add)</strong> để mở <strong>RussianDict</strong> như một ứng dụng độc lập.
                  </span>
                </li>
              </ol>

              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full min-h-[44px] rounded-lg bg-[#0F2342] text-white text-sm font-semibold hover:bg-[#163059]"
              >
                Đã hiểu
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
};
