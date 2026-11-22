import React, { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  BarChart3,
  BookMarked,
  BookOpen,
  LayoutDashboard,
  Menu,
  Newspaper,
  RefreshCw,
  Repeat,
  Settings,
  Sparkles,
  WifiOff,
  X,
} from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { useVirtualKeyboardOpen } from '../hooks/useVirtualKeyboardOpen';
import { t } from '../i18n/translations';
import { PWAInstallButton } from './PWAInstallButton';
import { SyncStatusBadge } from './SyncStatusBadge';

export const AppShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const {
    profile,
    vocabulary,
    capabilities,
    adaptiveAssessment,
    isOnline,
    swUpdateAvailable,
    applySwUpdate,
    offlineLessons,
    authUser,
  } = useAppState();
  const lang = profile.interfaceLanguage;
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const keyboardOpen = useVirtualKeyboardOpen();

  useEffect(() => {
    if (!location.hash) {
      window.scrollTo(0, 0);
    }
  }, [location.pathname, location.hash]);

  const dueCount = vocabulary.filter(
    (v) => new Date(v.nextReviewAt).getTime() <= Date.now(),
  ).length;

  const navItems = [
    { to: '/', label: t(lang, 'navDashboard'), mobileLabel: lang === 'vi' ? 'Tổng quan' : 'Home', icon: LayoutDashboard },
    { to: '/library', label: t(lang, 'navLibrary'), mobileLabel: lang === 'vi' ? 'Thư viện' : 'Library', icon: BookOpen },
    { to: '/news', label: t(lang, 'navDailyNews'), mobileLabel: lang === 'vi' ? 'Tin tức' : 'News', icon: Newspaper },
    { to: '/ai-lessons', label: t(lang, 'navAiLessons'), mobileLabel: lang === 'vi' ? 'Bài AI' : 'AI', icon: Sparkles },
    { to: '/vocabulary', label: t(lang, 'navVocabulary'), mobileLabel: lang === 'vi' ? 'Từ vựng' : 'Vocab', icon: BookMarked },
    {
      to: '/review',
      label: t(lang, 'navReview'),
      mobileLabel: lang === 'vi' ? 'Ôn tập' : 'Review',
      icon: Repeat,
      badge: dueCount > 0 ? dueCount : undefined,
    },
    { to: '/progress', label: t(lang, 'navProgress'), mobileLabel: lang === 'vi' ? 'Tiến độ' : 'Progress', icon: BarChart3 },
    { to: '/settings', label: t(lang, 'navSettings'), mobileLabel: lang === 'vi' ? 'Cài đặt' : 'Settings', icon: Settings },
  ];

  const primaryMobileTabs = [
    navItems[0],
    navItems[1],
    navItems[4],
    navItems[5],
  ];
  const secondaryMobileTabs = [navItems[2], navItems[3], navItems[6], navItems[7]];

  const isSecondaryActive = secondaryMobileTabs.some((item) =>
    item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to),
  );

  return (
    <div className="min-h-screen flex bg-[#F7F9FC] text-[#0F1E36]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 bg-[#0F2342] text-slate-100 border-r border-slate-800/70">
        <div className="px-6 pt-6 pb-5 border-b border-white/10">
          <NavLink to="/" className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded">
            <span className="text-base font-bold tracking-tight text-white block whitespace-nowrap">
              {t(lang, 'brandName')}
            </span>
            <span className="text-xs text-slate-300 mt-1 block">
              {t(lang, 'brandTagline')}
            </span>
          </NavLink>
        </div>

        <nav aria-label="Điều hướng chính" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center justify-between gap-3 px-3.5 py-2.5 min-h-[44px] rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-white/12 text-white'
                      : 'text-slate-300 hover:bg-white/6 hover:text-white'
                  }`
                }
              >
                <span className="flex items-center gap-3 min-w-0">
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span className="truncate">{item.label}</span>
                </span>
                {item.badge !== undefined && (
                  <span className="text-xs font-mono tabular-nums text-emerald-300">
                    {item.badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="px-5 py-4 border-t border-white/10 text-xs text-slate-300 space-y-2.5">
          <PWAInstallButton variant="sidebar" />
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-slate-400">CEFR ước tính</span>
              <span className="font-semibold text-white tabular-nums">
                {adaptiveAssessment.estimatedLevel}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-400">Ngoại tuyến</span>
              <span className="text-slate-200 tabular-nums">
                {offlineLessons.length} bài đã tải
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-slate-400">Đồng bộ</span>
              <NavLink to="/settings#cloud-sync" className="hover:opacity-90">
                <SyncStatusBadge compact darkSurface />
              </NavLink>
            </div>
            {authUser && (
              <div className="text-[11px] text-slate-300 truncate" title={authUser.email}>
                {authUser.email}
              </div>
            )}
            {!capabilities.supabaseConfigured && (
              <div className="text-[11px] text-slate-400">
                {t(lang, 'demoModeNotice')}
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 lg:pl-64 flex flex-col min-w-0">
        {/* Mobile Header (respects iOS top safe area) */}
        <header className="lg:hidden sticky top-0 z-30 safe-top bg-white border-b border-slate-200">
          <div className="h-14 px-4 flex items-center justify-between gap-2">
            <NavLink
              to="/"
              className="text-sm font-bold tracking-tight text-[#0F2342] whitespace-nowrap min-h-[44px] flex items-center"
            >
              {t(lang, 'brandName')}
            </NavLink>
            <div className="flex items-center gap-2 text-xs text-slate-600 shrink-0">
              <NavLink
                to="/settings"
                aria-label="Trạng thái đồng bộ đám mây"
                className="min-h-[44px] flex items-center"
              >
                <SyncStatusBadge compact />
              </NavLink>
              <PWAInstallButton variant="compact" />
            </div>
          </div>
        </header>

        {/* Offline / SW Update Banners */}
        {!isOnline && (
          <div
            role="status"
            aria-live="polite"
            className="bg-[#FFFBEB] border-b border-amber-200 px-4 sm:px-6 lg:px-8 py-2.5 text-xs text-amber-900"
          >
            <div className="max-w-[1200px] mx-auto flex items-center gap-2">
              <WifiOff className="w-4 h-4 shrink-0 text-amber-700" aria-hidden="true" />
              <span>
                Đang ngoại tuyến — Bài học đã tải ({offlineLessons.length}) và sổ tay từ vựng vẫn hoạt động.
              </span>
            </div>
          </div>
        )}

        {swUpdateAvailable && (
          <div
            role="status"
            aria-live="polite"
            className="bg-[#F2F6FC] border-b border-slate-200 px-4 sm:px-6 lg:px-8 py-2.5 text-xs text-[#0F2342]"
          >
            <div className="max-w-[1200px] mx-auto flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                Đã có phiên bản mới của Russian Dictation sẵn sàng.
              </span>
              <button
                type="button"
                onClick={() => void applySwUpdate()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[44px] rounded-lg bg-[#0F2342] text-white font-semibold hover:bg-[#163059]"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Cập nhật ngay</span>
              </button>
            </div>
          </div>
        )}

        <main
          className={`flex-1 w-full max-w-[1200px] mx-auto px-4 sm:px-6 lg:px-8 pt-5 sm:pt-6 lg:pb-10 ${
            keyboardOpen ? 'pb-8' : 'safe-main-bottom'
          }`}
        >
          {children}
        </main>
      </div>

      {/* Mobile Secondary Sheet */}
      {mobileMenuOpen && !keyboardOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-slate-900/40"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="absolute bottom-16 inset-x-0 bg-white border-t border-slate-200 rounded-t-2xl p-4 shadow-lg safe-bottom"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-3 mb-2 border-b border-slate-100">
              <span className="text-sm font-semibold text-[#0F2342]">
                {t(lang, 'navMore')}
              </span>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Đóng menu"
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1">
              {secondaryMobileTabs.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMobileMenuOpen(false)}
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-3 py-3 min-h-[44px] rounded-lg text-sm font-medium ${
                        isActive
                          ? 'bg-[#F2F6FC] text-[#0F2342]'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`
                    }
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Mobile Bottom Navigation (hidden while virtual keyboard is open, respects iOS safe area) */}
      {!keyboardOpen && (
        <nav
          aria-label="Điều hướng di động"
          className="lg:hidden fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 safe-bottom"
        >
          <div className="h-16 grid grid-cols-5">
            {primaryMobileTabs.map((item) => {
              const Icon = item.icon;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to === '/'}
                  onClick={() => setMobileMenuOpen(false)}
                  className={({ isActive }) =>
                    `relative flex flex-col items-center justify-center gap-1 min-h-[44px] text-[11px] font-medium px-1 transition-colors ${
                      isActive ? 'text-[#0F2342]' : 'text-slate-500'
                    }`
                  }
                >
                  <span className="relative">
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    {item.badge !== undefined && (
                      <span className="sr-only">({item.badge} đến hạn)</span>
                    )}
                  </span>
                  <span className="whitespace-nowrap">{item.mobileLabel}</span>
                </NavLink>
              );
            })}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((v) => !v)}
              aria-expanded={mobileMenuOpen}
              className={`flex flex-col items-center justify-center gap-1 min-h-[44px] text-[11px] font-medium px-1 ${
                isSecondaryActive || mobileMenuOpen ? 'text-[#0F2342]' : 'text-slate-500'
              }`}
            >
              <Menu className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{t(lang, 'navMore')}</span>
            </button>
          </div>
        </nav>
      )}
    </div>
  );
};
