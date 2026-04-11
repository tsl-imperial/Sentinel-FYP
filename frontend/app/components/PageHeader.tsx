import type { ReactNode } from 'react';

export function PageHeader({
  title,
  breadcrumb,
  description,
}: {
  title: string;
  breadcrumb?: string;
  description?: ReactNode;
}) {
  return (
    <div className="border-b border-slate-200 bg-slate-50/50">
      <div className="mx-auto max-w-[1600px] px-8 py-5">
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold text-slate-900 tracking-tight">{title}</h1>
          {breadcrumb && (
            <>
              <span className="text-slate-300">/</span>
              <span className="text-sm text-slate-500">{breadcrumb}</span>
            </>
          )}
        </div>
        {description && <p className="text-sm text-slate-500 mt-1">{description}</p>}
      </div>
    </div>
  );
}
