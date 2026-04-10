import { PageHeader } from '@/components/PageHeader';

export default function AboutPage() {
  return (
    <>
      <PageHeader title="About" description="Methodology, data sources, and pipeline overview." />
      <main className="mx-auto max-w-3xl px-8 py-10 space-y-12 flex-1">
        <section>
          <h2 className="text-base font-semibold text-slate-900 mb-3 tracking-tight">Overview</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Network Inspector combines OpenStreetMap road geometry with Sentinel-2 surface reflectance to
            characterise the drivable network and surrounding land cover across road corridors in West Africa.
            Analysts define a region of interest, extract a topologically clean network graph, and compute
            reflectance indices over the surrounding corridor.
          </p>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900 mb-3 tracking-tight">Data sources</h2>
          <div className="border border-slate-200 rounded-lg divide-y divide-slate-200">
            <div className="p-5">
              <div className="flex items-baseline justify-between mb-1">
                <div className="font-semibold text-slate-900 text-sm">Sentinel-2 Surface Reflectance (Harmonised)</div>
                <span className="label">10 m</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                <code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded text-[11px]">
                  COPERNICUS/S2_SR_HARMONIZED
                </code>{' '}
                via Google Earth Engine. Bands B2, B3, B4, B8, B11, B12. Quarterly median composites with
                configurable cloud filter.
              </p>
            </div>
            <div className="p-5">
              <div className="flex items-baseline justify-between mb-1">
                <div className="font-semibold text-slate-900 text-sm">OpenStreetMap drivable network</div>
                <span className="label">vector</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Pulled via osmnx with{' '}
                <code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded text-[11px]">
                  network_type=&quot;drive&quot;
                </code>
                . Classes: trunk, primary, secondary, tertiary, residential, service, unclassified, plus link
                variants.
              </p>
            </div>
            <div className="p-5">
              <div className="flex items-baseline justify-between mb-1">
                <div className="font-semibold text-slate-900 text-sm">World Bank ADM1 boundaries</div>
                <span className="label">administrative</span>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Administrative regions from{' '}
                <code className="bg-slate-100 text-slate-700 px-1 py-0.5 rounded text-[11px]">
                  projects/sat-io/open-datasets/WORLD-BANK/WBGAD/WB_GAD_ADM1
                </code>
                .
              </p>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-base font-semibold text-slate-900 mb-3 tracking-tight">Acknowledgements</h2>
          <p className="text-sm text-slate-600 leading-relaxed">
            Powered by Google Earth Engine, OpenStreetMap, and the European Space Agency Copernicus programme.
          </p>
        </section>
      </main>
    </>
  );
}
