import Link from 'next/link';

export function Footer() {
  return (
    <footer className="border-t border-slate-200 mt-2">
      <div className="mx-auto max-w-[1600px] px-8 py-4 text-xs text-slate-400 flex items-center justify-between">
        <span>Network Inspector</span>
        <Link href="/about" className="hover:text-slate-600">
          Methodology &amp; data sources
        </Link>
      </div>
    </footer>
  );
}
