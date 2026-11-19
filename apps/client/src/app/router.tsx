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
      ...plannedRoutes,
      { path: '*', Component: NotFoundPage },
    ],
  },
]);
