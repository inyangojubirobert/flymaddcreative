import type { MouseEvent, ReactNode } from 'react';
import { usePathname, useRouter } from 'expo-router';

import { WebMaxWidth } from '@/constants/theme';
import { useAuth } from '@/contexts/AuthContext';
import { useCart } from '@/contexts/CartContext';
import { useIsDesktopWeb } from '@/hooks/use-content-width';

// Hosted web app (/app) frame, styled like the website (navy gradient, glass
// navigation, gold brand). Desktop gets the website-style top navigation with
// the app's sections; phones keep the app's bottom tabs.

const BASE = (process.env.EXPO_BASE_URL || '').replace(/\/$/, '');

type NavItem = { label: string; path: string; match: (path: string) => boolean };

const SIGNED_IN: NavItem[] = [
  { label: 'Home', path: '/', match: (p) => p === '/' },
  { label: 'Shop', path: '/shop', match: (p) => p.startsWith('/shop') && p !== '/shop/cart' || p.startsWith('/catalogue/item') },
  { label: 'Search', path: '/search', match: (p) => p === '/search' },
  { label: 'Leaderboard', path: '/leaderboard', match: (p) => p === '/leaderboard' },
  { label: 'Library', path: '/library', match: (p) => p.startsWith('/library') },
  { label: 'Promote', path: '/promote', match: (p) => p.startsWith('/promote') },
  { label: 'Bascardo AI', path: '/ai', match: (p) => p.startsWith('/ai') },
];

const SIGNED_OUT: NavItem[] = [
  { label: 'Home', path: '/', match: (p) => p === '/' },
  { label: 'Shop', path: '/shop', match: (p) => p.startsWith('/shop') || p.startsWith('/catalogue/item') },
];

const CSS = `
html, body, #root {
  background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%) fixed;
  background-color: #0f172a;
  color: #f8fafc;
}
body { font-family: 'Inter', ui-sans-serif, system-ui, sans-serif; }
:root { --font-display: 'Inter', ui-sans-serif, system-ui, sans-serif; }
/* Beats react-native-web's per-class system font; icon fonts set inline styles and are unaffected. */
#root * { font-family: 'Inter', ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.od-shell { display: flex; flex-direction: column; height: 100%; min-height: 0; flex: 1; }
.od-nav {
  position: sticky; top: 0; z-index: 50; flex: none;
  background: rgba(0, 0, 0, 0.3); border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
.od-nav-inner {
  max-width: ${WebMaxWidth}px; margin: 0 auto; height: 64px; padding: 0 24px;
  display: flex; align-items: center; gap: 20px; box-sizing: border-box;
}
.od-brand {
  font-weight: 800; font-size: 20px; text-decoration: none; white-space: nowrap;
  background: linear-gradient(135deg, #FFD700, #FFA500, #FF6B35);
  -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent;
}
.od-links { display: flex; align-items: center; gap: 4px; flex: 1; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.od-link {
  color: #cbd5e1; text-decoration: none; font-size: 14px; font-weight: 600; white-space: nowrap;
  padding: 8px 12px; border-radius: 10px; transition: color .15s, background-color .15s;
}
.od-link:hover { color: #fff; background: rgba(255, 255, 255, 0.06); }
.od-link.active { color: #fde047; background: rgba(245, 196, 66, 0.12); }
.od-link.ai { color: #fde047; }
.od-actions { display: flex; align-items: center; gap: 10px; flex: none; }
.od-cart {
  position: relative; display: inline-flex; align-items: center; gap: 6px; color: #1a2e05; background: #c6f135;
  font-size: 13px; font-weight: 800; text-decoration: none; padding: 7px 12px; border-radius: 999px;
}
.od-cart-count {
  min-width: 18px; height: 18px; border-radius: 9px; background: #1a2e05; color: #c6f135;
  font-size: 11px; display: inline-flex; align-items: center; justify-content: center; padding: 0 4px; box-sizing: border-box;
}
.od-avatar {
  width: 36px; height: 36px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  background: linear-gradient(135deg, #facc15, #f97316); color: #000; font-weight: 800; text-decoration: none;
}
.od-avatar.active { box-shadow: 0 0 0 2px #fde047; }
.od-button {
  font-size: 14px; font-weight: 700; text-decoration: none; padding: 8px 16px; border-radius: 10px; white-space: nowrap;
}
.od-button.primary { background: #eab308; color: #000; }
.od-button.primary:hover { background: #ca8a04; }
.od-button.ghost { color: #cbd5e1; }
.od-button.ghost:hover { color: #fff; }
.od-website { color: #94a3b8; font-size: 13px; text-decoration: none; white-space: nowrap; }
.od-website:hover { color: #fff; }
.od-main { flex: 1; min-height: 0; display: flex; flex-direction: column; width: 100%; margin: 0 auto; }
.od-main.desktop { max-width: ${WebMaxWidth}px; }
`;

export function WebShell({ children }: { children: ReactNode }) {
  const desktop = useIsDesktopWeb();
  return (
    <div className="od-shell">
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" />
      <style>{CSS}</style>
      {desktop ? <TopNav /> : null}
      <div className={`od-main${desktop ? ' desktop' : ''}`}>{children}</div>
    </div>
  );
}

function TopNav() {
  const router = useRouter();
  const pathname = usePathname();
  const { token, participant } = useAuth();
  const { count } = useCart();

  const go = (path: string) => (event: MouseEvent) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    router.push(path as never);
  };
  const link = (path: string) => ({ href: `${BASE}${path === '/' ? '' : path}` || '/', onClick: go(path) });
  const items = token ? SIGNED_IN : SIGNED_OUT;

  return (
    <nav className="od-nav" aria-label="Main">
      <div className="od-nav-inner">
        <a className="od-brand" {...link('/')}>🌟 One Dream Initiative</a>
        <div className="od-links">
          {items.map((item) => (
            <a key={item.path} className={`od-link${item.match(pathname) ? ' active' : ''}${item.path === '/ai' ? ' ai' : ''}`} {...link(item.path)}>
              {item.label}
            </a>
          ))}
          <a className="od-link" {...link('/shop?view=directory')}>Categories</a>
        </div>
        <div className="od-actions">
          <a className="od-website" href="/Onedream.html">Website</a>
          <a className="od-cart" {...link('/shop/cart')} aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}>
            🛒 Cart {count ? <span className="od-cart-count">{count > 99 ? '99+' : count}</span> : null}
          </a>
          {token ? (
            <a className={`od-avatar${pathname === '/profile' ? ' active' : ''}`} {...link('/profile')} title="My profile">
              {(participant?.name || participant?.username || 'U').trim().charAt(0).toUpperCase()}
            </a>
          ) : (
            <>
              <a className="od-button ghost" {...link('/login')}>Login</a>
              <a className="od-button primary" {...link('/register')}>Get started</a>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
