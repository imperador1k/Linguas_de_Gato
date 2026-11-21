import { Menu, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { Link, Outlet, useLocation } from 'react-router';
import { titleForPath } from '@/app/modules';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/lib/theme';
import { BrandMark } from './brand-mark';
import { SettingsNavItem, SidebarNav } from './sidebar-nav';
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

/** Settings & data pinned at the bottom, with the quick theme switch beside the learner's language. */
function SidebarFooter({ onNavigate }: { onNavigate?: () => void }) {
  const theme = useTheme();
  return (
    <div className="mt-6 flex flex-col gap-4 border-t pt-4">
      <SettingsNavItem onNavigate={onNavigate} />
      <div className="flex items-center justify-between gap-3 px-3">
        <LearnerProfile />
        <ThemeSwitcher {...theme} />
      </div>
    </div>
  );
}

/**
 * Layout by width:
 * - ≥ 1024 px: full sidebar with group labels;
 * - 768–1023 px (tablets): slim icon rail with tooltips, so the content keeps its width;
 * - < 768 px: top bar and a navigation drawer (native <dialog>: focus is contained,
 *   Escape closes it, and focus returns to the menu button).
 */
export function AppShell() {
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    const title = titleForPath(pathname);
    document.title = title ? `${title} · ${APP_NAME}` : APP_NAME;

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
    <div className="min-h-dvh md:grid md:grid-cols-[4.5rem_minmax(0,1fr)] lg:grid-cols-[17rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-4 focus:py-2 focus:text-background"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col border-r bg-background px-4 py-6 lg:flex">
        <Link to="/" className="mb-8 rounded-md px-3 py-1" aria-label={`${APP_NAME} — today`}>
          <BrandMark />
        </Link>
        <div className="flex-1 overflow-y-auto pr-1">
          <SidebarNav idPrefix="sidebar" />
        </div>
        <SidebarFooter />
      </aside>

      {/* Tablet rail */}
      <aside className="sticky top-0 hidden h-dvh flex-col items-center border-r bg-background py-5 md:flex lg:hidden">
        <Link to="/" className="mb-6 rounded-md p-1" aria-label={`${APP_NAME} — today`}>
          <BrandMark compact />
        </Link>
        <div className="flex-1">
          <SidebarNav density="rail" idPrefix="rail" />
        </div>
        <div className="border-t pt-4">
          <SettingsNavItem density="rail" />
        </div>
      </aside>

      {/* Mobile header */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur-sm md:hidden">
        <Link to="/" className="rounded-md" aria-label={`${APP_NAME} — today`}>
          <BrandMark />
        </Link>
        <Button ref={menuButtonRef} variant="ghost" size="icon" aria-label="Open navigation" aria-haspopup="dialog" onClick={openDrawer}>
          <Menu aria-hidden="true" />
        </Button>
      </header>

      <dialog
        ref={drawerRef}
        aria-label="Navigation"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDrawer();
        }}
        onClose={() => menuButtonRef.current?.focus()}
        className="m-0 h-dvh max-h-none w-[min(20rem,85vw)] max-w-none bg-background p-0 text-foreground backdrop:bg-black/50 md:hidden"
      >
        <div className="flex h-full flex-col px-4 py-4">
          <div className="mb-6 flex items-center justify-between pl-3">
            <BrandMark />
            <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={closeDrawer}>
              <X aria-hidden="true" />
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <SidebarNav onNavigate={closeDrawer} idPrefix="drawer" />
          </div>
          <SidebarFooter onNavigate={closeDrawer} />
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
