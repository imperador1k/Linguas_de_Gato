import { Menu, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { findModuleByPath } from '@/app/modules';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';
import { BrandMark } from './brand-mark';
import { SidebarNav } from './sidebar-nav';
import { ThemeSwitcher } from './theme-switcher';

const APP_NAME = 'Linguas de Gato';

function LearnerProfile() {
  return (
    <p className="flex flex-col text-xs leading-snug text-muted-foreground">
      <span className="font-medium text-foreground">English</span>
      <span className="whitespace-nowrap">B2 → C1</span>
    </p>
  );
}

export function AppShell() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const isFirstRender = useRef(true);
  const theme = useTheme();

  useEffect(() => {
    const learningModule = findModuleByPath(pathname);
    document.title = learningModule ? `${learningModule.label} · ${APP_NAME}` : APP_NAME;

    // Move focus to the new page for keyboard and screen-reader users, but not on first load.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [pathname]);

  const openDrawer = () => drawerRef.current?.showModal();
  const closeDrawer = () => drawerRef.current?.close();

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-4 focus:py-2 focus:text-background"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-background px-4 py-6 lg:flex">
        <Link to="/" className="mb-8 rounded-md px-3 py-1" aria-label={`${APP_NAME} — overview`}>
          <BrandMark />
        </Link>
        <div className="flex-1 overflow-y-auto pr-1">
          <SidebarNav />
        </div>
        <div className="mt-6 flex items-center justify-between gap-3 border-t px-3 pt-5">
          <LearnerProfile />
          <ThemeSwitcher {...theme} />
        </div>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur-sm lg:hidden">
        <Link to="/" className="rounded-md" aria-label={`${APP_NAME} — overview`}>
          <BrandMark />
        </Link>
        <Button variant="ghost" size="icon" aria-label="Open navigation" aria-haspopup="dialog" onClick={openDrawer}>
          <Menu aria-hidden="true" />
        </Button>
      </header>

      {/* Mobile navigation drawer: native <dialog> gives focus trapping and Escape. */}
      <dialog
        ref={drawerRef}
        aria-label="Navigation"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDrawer();
        }}
        className="m-0 h-dvh max-h-none w-[min(20rem,85vw)] max-w-none bg-background p-0 text-foreground backdrop:bg-black/50 lg:hidden"
      >
        <div className="flex h-full flex-col px-4 py-4">
          <div className="mb-6 flex items-center justify-between pl-3">
            <BrandMark />
            <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={closeDrawer}>
              <X aria-hidden="true" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SidebarNav onNavigate={closeDrawer} />
          </div>
          <div className="mt-6 flex items-center justify-between gap-3 border-t px-3 pt-5">
            <LearnerProfile />
            <ThemeSwitcher {...theme} />
          </div>
        </div>
      </dialog>

      <main id="main" ref={mainRef} tabIndex={-1} className="min-w-0 outline-none">
        <div className="mx-auto w-full max-w-6xl px-4 pt-8 pb-16 sm:px-8 sm:pt-12 lg:px-12">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
