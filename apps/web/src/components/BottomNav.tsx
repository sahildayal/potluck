import { Link, useLocation } from 'wouter';

/**
 * The dark pill nav from the reference.
 *
 * Shopping earns a tab because it is the screen you open one-handed in a
 * supermarket — precisely the case a bottom tab exists for. Adding a recipe is
 * a floating button rather than a tab: it is an action, not a place, and giving
 * it a tab would mean pretending you can be "in" it.
 */

const TABS = [
  { href: '/', label: 'Recipes', icon: BookIcon },
  { href: '/favourites', label: 'Favourites', icon: HeartIcon },
  { href: '/shopping', label: 'Shopping', icon: BasketIcon },
  { href: '/you', label: 'You', icon: PersonIcon },
] as const;

export function BottomNav() {
  const [location] = useLocation();

  return (
    <nav className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-3">
      <ul className="pointer-events-auto flex w-full max-w-md items-stretch gap-1 rounded-full bg-primary p-1.5 shadow-[var(--shadow-lift)]">
        {TABS.map((tab) => {
          const active = tab.href === '/' ? location === '/' : location.startsWith(tab.href);
          const Icon = tab.icon;
          return (
            <li key={tab.href} className="flex-1">
              <Link
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 rounded-full px-2 py-2 text-[0.6875rem] font-semibold transition-opacity ${
                  active
                    ? 'bg-ground text-ink'
                    : 'text-primary-ink opacity-60 hover:opacity-100'
                }`}
              >
                <Icon className="h-5 w-5" />
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Leaves room for the floating nav AND the add button that sits above it, so
 * the last card is never trapped under either.
 */
export function NavSpacer() {
  return <div aria-hidden="true" className="h-48" />;
}

interface IconProps {
  className?: string;
}

function BookIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 5a2 2 0 0 1 2-2h11a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H6a2 2 0 0 1-2-2V5Z" />
      <path d="M8 3v18" />
    </svg>
  );
}

function HeartIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20s-7-4.6-7-9.5A4.5 4.5 0 0 1 12 7a4.5 4.5 0 0 1 7 3.5C19 15.4 12 20 12 20Z" />
    </svg>
  );
}

function BasketIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 9h16l-1.4 9.2A2 2 0 0 1 16.6 20H7.4a2 2 0 0 1-2-1.8L4 9Z" />
      <path d="M9 9 11 4M15 9 13 4" />
    </svg>
  );
}

function PersonIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
    </svg>
  );
}
