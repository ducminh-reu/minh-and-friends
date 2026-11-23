import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  KeyRound,
  LogIn,
  LogOut,
  RefreshCw,
  UserPlus,
} from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import { checkRemoteSchemaStatus, type SupabaseSchemaStatus } from '../services/supabaseClient';
import { SyncStatusBadge } from './SyncStatusBadge';

type AuthTab = 'login' | 'signup' | 'reset';

function mapAuthErrorToVi(err: unknown): string {
  const msg =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err ?? '');
  const lower = msg.toLowerCase();

  if (lower.includes('unsupported provider') || lower.includes('provider is not enabled')) {
    return 'Nhà cung cấp Google chưa được bật trên Supabase. Vui lòng bật Google Provider trong Supabase Dashboard → Authentication → Providers.';
  }
  if (lower.includes('invalid login credentials')) {
    return 'Email hoặc mật khẩu chưa chính xác.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Email chưa được xác nhận. Vui lòng kiểm tra hộp thư đến hoặc thư rác để xác nhận tài khoản.';
  }
  if (lower.includes('user already registered')) {
    return 'Email này đã được đăng ký. Hãy chuyển sang tab Đăng nhập hoặc Quên mật khẩu.';
  }
  if (lower.includes('password should be at least')) {
    return 'Mật khẩu cần có ít nhất 6 ký tự.';
  }
  if (lower.includes('rate limit') || lower.includes('too many requests')) {
    return 'Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại.';
  }
  if (lower.includes('unable to validate email address') || lower.includes('invalid email')) {
    return 'Địa chỉ email không hợp lệ.';
  }
  return msg || 'Không thể kết nối tới máy chủ xác thực Supabase.';
}

export const AuthSyncSection: React.FC = () => {
  const {
    authUser,
    authLoading,
    passwordRecoveryPending,
    capabilities,
    isOnline,
    syncStatus,
    syncError,
    lastSyncedAt,
    pendingSyncCount,
    profile,
    signInWithCloud,
    signUpWithCloud,
    signOutCloud,
    requestCloudPasswordReset,
    completeCloudPasswordReset,
    dismissPasswordRecovery,
    syncNow,
  } = useAppState();

  const [tab, setTab] = useState<AuthTab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);
  const [schemaStatus, setSchemaStatus] = useState<SupabaseSchemaStatus | null>(null);

  useEffect(() => {
    if (!isOnline || !capabilities.supabaseConfigured) return;
    let cancelled = false;
    void checkRemoteSchemaStatus().then((status) => {
      if (!cancelled) setSchemaStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [isOnline, capabilities.supabaseConfigured, syncStatus]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormNotice(null);
    if (!email.trim() || !password) {
      setFormError('Vui lòng nhập đầy đủ email và mật khẩu.');
      return;
    }
    setSubmitting(true);
    try {
      await signInWithCloud(email, password);
      setPassword('');
      setFormNotice('Đăng nhập thành công. Đang đồng bộ dữ liệu học tập...');
    } catch (err) {
      setFormError(mapAuthErrorToVi(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormNotice(null);
    if (!email.trim() || password.length < 6) {
      setFormError('Vui lòng nhập email hợp lệ và mật khẩu tối thiểu 6 ký tự.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await signUpWithCloud(
        email,
        password,
        displayName.trim() || profile.displayName,
      );
      setPassword('');
      if (res.needsEmailConfirmation) {
        setFormNotice(
          'Đăng ký thành công! Vui lòng kiểm tra email để xác nhận tài khoản trước khi đăng nhập.',
        );
      } else {
        setFormNotice('Tạo tài khoản và đăng nhập thành công. Dữ liệu cục bộ đang được đồng bộ.');
      }
    } catch (err) {
      setFormError(mapAuthErrorToVi(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordResetRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormNotice(null);
    if (!email.trim()) {
      setFormError('Vui lòng nhập email tài khoản cần đặt lại mật khẩu.');
      return;
    }
    setSubmitting(true);
    try {
      await requestCloudPasswordReset(email);
      setFormNotice(
        'Đã gửi liên kết đặt lại mật khẩu qua email (nếu địa chỉ này tồn tại trong hệ thống).',
      );
    } catch (err) {
      setFormError(mapAuthErrorToVi(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormNotice(null);
    if (newPassword.length < 6) {
      setFormError('Mật khẩu mới cần tối thiểu 6 ký tự.');
      return;
    }
    setSubmitting(true);
    try {
      await completeCloudPasswordReset(newPassword);
      setNewPassword('');
      setFormNotice('Đã cập nhật mật khẩu mới thành công.');
    } catch (err) {
      setFormError(mapAuthErrorToVi(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleManualSync = async () => {
    setFormError(null);
    setFormNotice(null);
    const ok = await syncNow();
    if (ok) {
      setFormNotice('Đã đồng bộ dữ liệu hai chiều với Supabase.');
    }
  };

  const handleSignOut = async () => {
    setFormError(null);
    setFormNotice(null);
    setSubmitting(true);
    try {
      await signOutCloud();
      setFormNotice(
        'Đã đăng xuất. Dữ liệu đã lưu cục bộ trên trình duyệt vẫn được giữ nguyên.',
      );
    } catch (err) {
      setFormError(mapAuthErrorToVi(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      id="cloud-sync"
      className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 space-y-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-[#0F2342] flex items-center gap-2">
            <Cloud className="w-4 h-4 text-[#1E4178]" aria-hidden="true" />
            <span>Tài khoản & Đồng bộ đám mây (Supabase)</span>
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Đồng bộ từ vựng, bài học đã lưu, bản nháp nghe chép, lịch sử ôn tập SRS và thống kê tiến độ giữa nhiều thiết bị.
          </p>
        </div>
        <SyncStatusBadge />
      </div>

      {/* Password Recovery Banner when user opens reset link */}
      {passwordRecoveryPending && (
        <form
          onSubmit={handleCompleteRecovery}
          className="p-4 rounded-xl border border-[#1E4178]/30 bg-[#F2F6FC] space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold text-[#0F2342] flex items-center gap-2">
              <KeyRound className="w-4 h-4" aria-hidden="true" />
              <span>Đặt mật khẩu mới cho tài khoản của bạn</span>
            </div>
            <button
              type="button"
              onClick={dismissPasswordRecovery}
              className="text-xs font-medium text-slate-600 hover:underline min-h-[44px] px-2"
            >
              Đóng
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mật khẩu mới (tối thiểu 6 ký tự)"
              minLength={6}
              className="flex-1 min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
            />
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2.5 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-xs font-semibold hover:bg-[#163059] disabled:opacity-60 whitespace-nowrap"
            >
              {submitting ? 'Đang cập nhật...' : 'Lưu mật khẩu mới'}
            </button>
          </div>
        </form>
      )}

      {!capabilities.supabaseConfigured && capabilities.loaded ? (
        <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600">
          Tiến trình học tập và từ vựng của bạn được lưu trữ an toàn trên thiết bị. Bạn có thể đăng nhập để đồng bộ qua đám mây bất cứ lúc nào.
        </div>
      ) : authLoading ? (
        <div className="text-xs text-slate-500 py-2">Đang tải thông tin tài khoản...</div>
      ) : authUser ? (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div className="p-3.5 rounded-lg border border-slate-200 bg-[#FAFCFF]">
              <div className="text-slate-500">Tài khoản đang đăng nhập</div>
              <div className="font-semibold text-[#0F2342] mt-1 truncate" title={authUser.email}>
                {authUser.email}
              </div>
              <div className="text-[11px] text-slate-500 font-mono mt-0.5 truncate">
                UID: {authUser.id.slice(0, 8)}…
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 bg-[#FAFCFF]">
              <div className="text-slate-500">Lần đồng bộ gần nhất</div>
              <div className="font-semibold text-[#0F2342] mt-1 tabular-nums">
                {lastSyncedAt
                  ? new Date(lastSyncedAt).toLocaleString('vi-VN')
                  : 'Chưa đồng bộ xong'}
              </div>
            </div>

            <div className="p-3.5 rounded-lg border border-slate-200 bg-[#FAFCFF]">
              <div className="text-slate-500">Hàng đợi thay đổi cục bộ</div>
              <div className="font-semibold text-[#0F2342] mt-1 tabular-nums">
                {pendingSyncCount === 0
                  ? 'Không còn thay đổi chờ'
                  : `${pendingSyncCount} thay đổi đang chờ mạng`}
              </div>
            </div>
          </div>

          {syncStatus === 'sync_failed' && syncError && (
            <div
              role="alert"
              className="p-3.5 rounded-lg border border-red-200 bg-red-50 text-xs text-red-800 space-y-1"
            >
              <div className="font-semibold">Lỗi đồng bộ: {syncError.kind}</div>
              <div>{syncError.message}</div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              disabled={!isOnline || syncStatus === 'syncing'}
              onClick={() => void handleManualSync()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-xs font-semibold hover:bg-[#163059] disabled:opacity-60"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              <span>{syncStatus === 'syncing' ? 'Đang đồng bộ...' : 'Đồng bộ ngay'}</span>
            </button>

            <button
              type="button"
              disabled={submitting}
              onClick={() => void handleSignOut()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 min-h-[44px] rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Đăng xuất</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-lg w-full sm:w-fit">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setFormError(null);
                setFormNotice(null);
              }}
              className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                tab === 'login'
                  ? 'bg-white text-[#0F2342] shadow-xs'
                  : 'text-slate-600 hover:text-[#0F2342]'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Đăng nhập</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTab('signup');
                setFormError(null);
                setFormNotice(null);
              }}
              className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                tab === 'signup'
                  ? 'bg-white text-[#0F2342] shadow-xs'
                  : 'text-slate-600 hover:text-[#0F2342]'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Đăng ký</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTab('reset');
                setFormError(null);
                setFormNotice(null);
              }}
              className={`flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 min-h-[44px] rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                tab === 'reset'
                  ? 'bg-white text-[#0F2342] shadow-xs'
                  : 'text-slate-600 hover:text-[#0F2342]'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Quên mật khẩu</span>
            </button>
          </div>

          {tab === 'login' && (
            <form onSubmit={handleLogin} className="space-y-3 max-w-md">
              <div>
                <label htmlFor="auth-login-email" className="block text-xs font-medium text-slate-600 mb-1">
                  Email
                </label>
                <input
                  id="auth-login-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="auth-login-password" className="block text-xs font-medium text-slate-600 mb-1">
                  Mật khẩu
                </label>
                <input
                  id="auth-login-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !isOnline}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-xs font-semibold hover:bg-[#163059] disabled:opacity-60"
              >
                <LogIn className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{submitting ? 'Đang đăng nhập...' : 'Đăng nhập & Đồng bộ'}</span>
              </button>
            </form>
          )}

          {tab === 'signup' && (
            <form onSubmit={handleSignUp} className="space-y-3 max-w-md">
              <div>
                <label htmlFor="auth-signup-name" className="block text-xs font-medium text-slate-600 mb-1">
                  Tên hiển thị
                </label>
                <input
                  id="auth-signup-name"
                  type="text"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={profile.displayName}
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="auth-signup-email" className="block text-xs font-medium text-slate-600 mb-1">
                  Email
                </label>
                <input
                  id="auth-signup-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <div>
                <label htmlFor="auth-signup-password" className="block text-xs font-medium text-slate-600 mb-1">
                  Mật khẩu (tối thiểu 6 ký tự)
                </label>
                <input
                  id="auth-signup-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !isOnline}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-xs font-semibold hover:bg-[#163059] disabled:opacity-60"
              >
                <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{submitting ? 'Đang tạo tài khoản...' : 'Tạo tài khoản & Chuyển dữ liệu'}</span>
              </button>
            </form>
          )}

          {tab === 'reset' && (
            <form onSubmit={handlePasswordResetRequest} className="space-y-3 max-w-md">
              <div>
                <label htmlFor="auth-reset-email" className="block text-xs font-medium text-slate-600 mb-1">
                  Email tài khoản
                </label>
                <input
                  id="auth-reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full min-h-[44px] px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>
              <button
                type="submit"
                disabled={submitting || !isOnline}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 min-h-[44px] rounded-lg bg-[#0F2342] text-white text-xs font-semibold hover:bg-[#163059] disabled:opacity-60"
              >
                <KeyRound className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{submitting ? 'Đang gửi...' : 'Gửi email đặt lại mật khẩu'}</span>
              </button>
            </form>
          )}

          <p className="text-xs text-slate-500">
            Dữ liệu cục bộ hiện tại trong localStorage và IndexedDB được giữ nguyên và tự động gộp vào tài khoản khi đăng nhập, không trùng lặp từ vựng hay mất bản nháp.
          </p>
        </div>
      )}

      {formError && (
        <div
          role="alert"
          className="p-3 rounded-lg border border-red-200 bg-red-50 text-xs text-red-700"
        >
          {formError}
        </div>
      )}

      {formNotice && (
        <div
          role="status"
          className="p-3 rounded-lg border border-[#1F7A6E]/30 bg-[#F2F9F8] text-xs text-[#165B52] flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{formNotice}</span>
        </div>
      )}
    </section>
  );
};
