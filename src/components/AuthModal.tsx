import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Loader2,
  LogIn,
  UserPlus,
  X,
} from 'lucide-react';
import { useAppState } from '../context/AppStateContext';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'login' | 'signup' | 'reset';
}

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

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'login',
}) => {
  const {
    signInWithCloud,
    signUpWithCloud,
    requestCloudPasswordReset,
    profile,
  } = useAppState();

  const [tab, setTab] = useState<'login' | 'signup' | 'reset'>(initialTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formNotice, setFormNotice] = useState<string | null>(null);

  if (!isOpen) return null;

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
      await signInWithCloud(email.trim(), password);
      setFormNotice('Đăng nhập thành công! Đang đồng bộ dữ liệu...');
      setTimeout(() => {
        onClose();
      }, 700);
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
        email.trim(),
        password,
        displayName.trim() || profile.displayName,
      );
      if (res.needsEmailConfirmation) {
        setFormNotice(
          'Đăng ký thành công! Vui lòng kiểm tra email để xác nhận tài khoản trước khi đăng nhập.',
        );
      } else {
        setFormNotice('Tạo tài khoản và đăng nhập thành công. Đang tải dữ liệu...');
        setTimeout(() => {
          onClose();
        }, 800);
      }
    } catch (err) {
      setFormError(mapAuthErrorToVi(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormNotice(null);
    if (!email.trim()) {
      setFormError('Vui lòng nhập email tài khoản cần đặt lại mật khẩu.');
      return;
    }
    setSubmitting(true);
    try {
      await requestCloudPasswordReset(email.trim());
      setFormNotice(
        'Đã gửi liên kết đặt lại mật khẩu qua email (nếu địa chỉ này tồn tại trong hệ thống).',
      );
    } catch (err) {
      setFormError(mapAuthErrorToVi(err));
    } finally {
      setSubmitting(false);
    }
  };



  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
    >
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xl max-w-md w-full p-6 space-y-5 relative">
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng cửa sổ"
          className="absolute right-4 top-4 text-slate-400 hover:text-slate-700 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>

        <div>
          <h2 id="auth-modal-title" className="text-xl font-bold text-[#0F2342]">
            {tab === 'login' && 'Đăng nhập vào Russian Dictation'}
            {tab === 'signup' && 'Tạo tài khoản mới'}
            {tab === 'reset' && 'Khôi phục mật khẩu'}
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Đồng bộ tiến trình học tập, từ vựng và lịch sử chép chính tả an toàn trên Supabase.
          </p>
        </div>



        {/* Tab Switcher */}
        <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 rounded-xl" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'login'}
            onClick={() => {
              setTab('login');
              setFormError(null);
              setFormNotice(null);
            }}
            className={`py-2 px-2 min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
              tab === 'login'
                ? 'bg-white text-[#0F2342] shadow-xs'
                : 'text-slate-600 hover:text-[#0F2342]'
            }`}
          >
            Đăng nhập
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'signup'}
            onClick={() => {
              setTab('signup');
              setFormError(null);
              setFormNotice(null);
            }}
            className={`py-2 px-2 min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
              tab === 'signup'
                ? 'bg-white text-[#0F2342] shadow-xs'
                : 'text-slate-600 hover:text-[#0F2342]'
            }`}
          >
            Đăng ký
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'reset'}
            onClick={() => {
              setTab('reset');
              setFormError(null);
              setFormNotice(null);
            }}
            className={`py-2 px-2 min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
              tab === 'reset'
                ? 'bg-white text-[#0F2342] shadow-xs'
                : 'text-slate-600 hover:text-[#0F2342]'
            }`}
          >
            Quên MK
          </button>
        </div>

        {/* Forms */}
        {tab === 'login' && (
          <form onSubmit={handleLogin} className="space-y-3.5">
            <div>
              <label htmlFor="modal-login-email" className="block text-xs font-medium text-slate-600 mb-1">
                Email
              </label>
              <input
                id="modal-login-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#0F2342]/20 focus:border-[#0F2342]"
              />
            </div>
            <div>
              <label htmlFor="modal-login-password" className="block text-xs font-medium text-slate-600 mb-1">
                Mật khẩu
              </label>
              <input
                id="modal-login-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#0F2342]/20 focus:border-[#0F2342]"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 py-3 min-h-[48px] rounded-xl bg-[#0F2342] text-white text-sm font-semibold hover:bg-[#163059] disabled:opacity-60 transition-colors shadow-sm"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>Đang đăng nhập...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4" aria-hidden="true" />
                  <span>Đăng nhập ngay</span>
                </>
              )}
            </button>
          </form>
        )}

        {tab === 'signup' && (
          <form onSubmit={handleSignUp} className="space-y-3.5">
            <div>
              <label htmlFor="modal-signup-name" className="block text-xs font-medium text-slate-600 mb-1">
                Tên hiển thị
              </label>
              <input
                id="modal-signup-name"
                type="text"
                autoComplete="name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={profile.displayName}
                className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#0F2342]/20 focus:border-[#0F2342]"
              />
            </div>
            <div>
              <label htmlFor="modal-signup-email" className="block text-xs font-medium text-slate-600 mb-1">
                Email
              </label>
              <input
                id="modal-signup-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#0F2342]/20 focus:border-[#0F2342]"
              />
            </div>
            <div>
              <label htmlFor="modal-signup-password" className="block text-xs font-medium text-slate-600 mb-1">
                Mật khẩu (tối thiểu 6 ký tự)
              </label>
              <input
                id="modal-signup-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#0F2342]/20 focus:border-[#0F2342]"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 py-3 min-h-[48px] rounded-xl bg-[#0F2342] text-white text-sm font-semibold hover:bg-[#163059] disabled:opacity-60 transition-colors shadow-sm"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>Đang tạo tài khoản...</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" aria-hidden="true" />
                  <span>Tạo tài khoản mới</span>
                </>
              )}
            </button>
          </form>
        )}

        {tab === 'reset' && (
          <form onSubmit={handlePasswordReset} className="space-y-3.5">
            <div>
              <label htmlFor="modal-reset-email" className="block text-xs font-medium text-slate-600 mb-1">
                Email tài khoản cần khôi phục
              </label>
              <input
                id="modal-reset-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="w-full min-h-[44px] px-3.5 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-[#0F2342]/20 focus:border-[#0F2342]"
              />
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 py-3 min-h-[48px] rounded-xl bg-[#0F2342] text-white text-sm font-semibold hover:bg-[#163059] disabled:opacity-60 transition-colors shadow-sm"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                  <span>Đang gửi...</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" aria-hidden="true" />
                  <span>Gửi email đặt lại mật khẩu</span>
                </>
              )}
            </button>
          </form>
        )}

        {formError && (
          <div
            role="alert"
            className="p-3.5 rounded-xl border border-red-200 bg-red-50 text-xs text-red-800 flex items-start gap-2"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        )}

        {formNotice && (
          <div
            role="status"
            className="p-3.5 rounded-xl border border-[#1F7A6E]/30 bg-[#F2F9F8] text-xs text-[#165B52] flex items-start gap-2"
          >
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-[#1F7A6E]" aria-hidden="true" />
            <span>{formNotice}</span>
          </div>
        )}
      </div>
    </div>
  );
};
