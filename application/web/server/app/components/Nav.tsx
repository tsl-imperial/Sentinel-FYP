'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  { href: '/workbench', label: 'Workbench' },
  { href: '/regions', label: 'Regions' },
  { href: '/exports', label: 'Exports' },
  { href: '/about', label: 'About' },
];

export function Nav() {
  const pathname = usePathname();
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-[1600px] px-8 py-3.5 flex items-center justify-between">
        <Link href="/workbench" className="flex items-center gap-3">
          <svg width="22" height="22" viewBox="0 0 24 24" className="text-slate-900">
            <line x1="5" y1="6" x2="12" y2="14" stroke="currentColor" strokeWidth="1.2" />
            <line x1="12" y1="14" x2="19" y2="6" stroke="currentColor" strokeWidth="1.2" />
            <line x1="12" y1="14" x2="12" y2="20" stroke="currentColor" strokeWidth="1.2" />
            <circle cx="5" cy="6" r="2.2" fill="currentColor" />
            <circle cx="19" cy="6" r="2.2" fill="currentColor" />
            <circle cx="12" cy="14" r="2.2" fill="currentColor" />
            <circle cx="12" cy="20" r="2.2" fill="currentColor" />
          </svg>
          <span className="font-semibold text-slate-900 tracking-tight text-[15px]">Network Inspector</span>
        </Link>

        <nav className="flex items-center gap-6 text-sm">
          {ITEMS.map((item) => {
            const active = pathname === item.href || (item.href === '/workbench' && pathname === '/');
            return (
              <Link
                key={item.href}
                href={item.href}
                className={
                  active
                    ? 'text-slate-900 font-medium border-b-2 border-slate-900 pb-3 -mb-3'
                    : 'text-slate-500 hover:text-slate-900 pb-3 -mb-3 border-b-2 border-transparent'
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>Connected</span>
        </div>
      </div>
    </header>
  );
}
