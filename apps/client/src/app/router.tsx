import { createBrowserRouter, type RouteObject } from 'react-router';
import { AppShell } from '@/components/layout/app-shell';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { NotFoundPage, RouteErrorPage } from '@/features/planned/not-found-page';
import { PlannedModulePage } from '@/features/planned/planned-module-page';
import { MODULES } from './modules';

function AppLoading() {
  return (
    <p role="status" className="grid min-h-dvh place-items-center text-sm text-muted-foreground">
      Loading…
    </p>
  );
}

const plannedRoutes: RouteObject[] = MODULES.filter((learningModule) => learningModule.status === 'planned').map(
  (learningModule) => ({
    path: learningModule.path.slice(1),
    element: <PlannedModulePage moduleId={learningModule.id} />,
  }),
);

export const router = createBrowserRouter([
  {
    path: '/',
    Component: AppShell,
    ErrorBoundary: RouteErrorPage,
    // Shown while a lazy route (e.g. /listening) loads on a direct visit.
    HydrateFallback: AppLoading,
    children: [
      { index: true, Component: DashboardPage },
      {
        path: 'listening',
        lazy: async () => {
          const { ListeningPage } = await import('@/features/listening/listening-page');
          return { Component: ListeningPage };
        },
      },
      {
        path: 'listening/session/:sessionId',
        lazy: async () => {
          const { ListeningSessionPage } = await import('@/features/listening/listening-session-page');
          return { Component: ListeningSessionPage };
        },
      },
      {
        path: 'speaking',
        lazy: async () => {
          const { SpeakingLabPage } = await import('@/features/speaking/speaking-lab-page');
          return { Component: SpeakingLabPage };
        },
      },
      {
        // source: "library" (a curated prompt id) or "custom" (a saved topic id).
        path: 'speaking/practice/:source/:topicId',
        lazy: async () => {
          const { SpeakingPracticePage } = await import('@/features/speaking/speaking-practice-page');
          return { Component: SpeakingPracticePage };
        },
      },
      {
        path: 'speaking/attempts/:attemptId',
        lazy: async () => {
          const { SpeakingAttemptPage } = await import('@/features/speaking/speaking-attempt-page');
          return { Component: SpeakingAttemptPage };
        },
      },
      {
        path: 'writing',
        lazy: async () => {
          const { WritingLabPage } = await import('@/features/writing/writing-lab-page');
          return { Component: WritingLabPage };
        },
      },
      {
        path: 'writing/tasks/:taskId',
        lazy: async () => {
          const { WritingEditorPage } = await import('@/features/writing/writing-editor-page');
          return { Component: WritingEditorPage };
        },
      },
      {
        path: 'writing/attempts/:attemptId',
        lazy: async () => {
          const { WritingAttemptPage } = await import('@/features/writing/writing-attempt-page');
          return { Component: WritingAttemptPage };
        },
      },
      {
        path: 'grammar',
        lazy: async () => {
          const { GrammarLabPage } = await import('@/features/grammar/grammar-lab-page');
          return { Component: GrammarLabPage };
        },
      },
      {
        path: 'grammar/sets/:setId',
        lazy: async () => {
          const { GrammarSetPage } = await import('@/features/grammar/grammar-set-page');
          return { Component: GrammarSetPage };
        },
      },
      ...plannedRoutes,
      { path: '*', Component: NotFoundPage },
    ],
  },
]);
