import { Suspense, lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { AppStateProvider } from './context/AppStateContext';
import { DashboardPage } from './pages/DashboardPage';

const LibraryPage = lazy(() =>
  import('./pages/LibraryPage').then((m) => ({ default: m.LibraryPage })),
);
const DictationWorkspacePage = lazy(() =>
  import('./pages/DictationWorkspacePage').then((m) => ({ default: m.DictationWorkspacePage })),
);
const AiLessonsPage = lazy(() =>
  import('./pages/AiLessonsPage').then((m) => ({ default: m.AiLessonsPage })),
);
const DailyNewsPage = lazy(() =>
  import('./pages/DailyNewsPage').then((m) => ({ default: m.DailyNewsPage })),
);
const VocabularyNotebookPage = lazy(() =>
  import('./pages/VocabularyNotebookPage').then((m) => ({ default: m.VocabularyNotebookPage })),
);
const ReviewPage = lazy(() =>
  import('./pages/ReviewPage').then((m) => ({ default: m.ReviewPage })),
);
const ProgressPage = lazy(() =>
  import('./pages/ProgressPage').then((m) => ({ default: m.ProgressPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

function RouteLoadingFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="min-h-[40vh] flex items-center justify-center"
    >
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-3 text-sm text-slate-600">
        Đang tải trang...
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppStateProvider>
      <BrowserRouter>
        <AppShell>
          <Suspense fallback={<RouteLoadingFallback />}>
            <Routes>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/news" element={<DailyNewsPage />} />
              <Route path="/dictation/:lessonId" element={<DictationWorkspacePage />} />
              <Route path="/ai-lessons" element={<AiLessonsPage />} />
              <Route path="/vocabulary" element={<VocabularyNotebookPage />} />
              <Route path="/review" element={<ReviewPage />} />
              <Route path="/progress" element={<ProgressPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Suspense>
        </AppShell>
      </BrowserRouter>
    </AppStateProvider>
  );
}
