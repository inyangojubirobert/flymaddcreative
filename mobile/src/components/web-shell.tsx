import type { ReactNode } from 'react';

/** Native apps have no web shell: screens render as they are. See web-shell.web.tsx. */
export function WebShell({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
