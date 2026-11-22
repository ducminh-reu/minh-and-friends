import React from 'react';
import { AlertCircle, CheckCircle2, CloudOff, Loader2 } from 'lucide-react';
import { useAppState } from '../context/AppStateContext';
import type { CloudSyncStatus } from '../utils/cloudSyncEngine';

interface SyncStatusBadgeProps {
  compact?: boolean;
  darkSurface?: boolean;
}

export const SYNC_STATUS_LABELS: Record<
  CloudSyncStatus,
  { vi: string; en: string }
> = {
  local_only: { vi: 'Chỉ lưu cục bộ', en: 'Local only' },
  syncing: { vi: 'Đang đồng bộ', en: 'Syncing' },
  synced: { vi: 'Đã đồng bộ', en: 'Synced' },
  sync_failed: { vi: 'Đồng bộ thất bại', en: 'Sync failed' },
};

export const SyncStatusBadge: React.FC<SyncStatusBadgeProps> = ({
  compact = false,
  darkSurface = false,
}) => {
  const { syncStatus, pendingSyncCount, profile } = useAppState();
  const lang = profile.interfaceLanguage;
  const label = SYNC_STATUS_LABELS[syncStatus][lang];

  const getVisuals = () => {
    switch (syncStatus) {
      case 'syncing':
        return {
          icon: <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />,
          classes: darkSurface
            ? 'text-sky-200 bg-white/10 border-white/15'
            : 'text-[#1E4178] bg-[#F2F6FC] border-slate-200',
        };
      case 'synced':
        return {
          icon: <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
          classes: darkSurface
            ? 'text-emerald-200 bg-emerald-950/50 border-emerald-400/30'
            : 'text-[#165B52] bg-[#F2F9F8] border-[#1F7A6E]/30',
        };
      case 'sync_failed':
        return {
          icon: <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
          classes: darkSurface
            ? 'text-red-200 bg-red-950/60 border-red-400/40'
            : 'text-red-700 bg-red-50 border-red-200',
        };
      case 'local_only':
      default:
        return {
          icon: <CloudOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />,
          classes: darkSurface
            ? 'text-slate-200 bg-white/10 border-white/15'
            : 'text-slate-700 bg-slate-100 border-slate-200',
        };
    }
  };

  const { icon, classes } = getVisuals();

  return (
    <span
      data-testid="sync-status-badge"
      data-sync-status={syncStatus}
      className={`inline-flex items-center gap-1.5 rounded-lg border font-medium whitespace-nowrap ${
        compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs'
      } ${classes}`}
    >
      {icon}
      <span>{label}</span>
      {pendingSyncCount > 0 && syncStatus !== 'synced' && (
        <span className="tabular-nums opacity-85">
          ({pendingSyncCount})
        </span>
      )}
    </span>
  );
};
