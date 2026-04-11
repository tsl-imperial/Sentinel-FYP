import type { Metadata } from 'next';
import './globals.css';
// MapLibre CSS at the root layout: dynamic-import chains don't reliably pull
// node_modules CSS into the page's CSS chunk, so the .maplibregl-map and
// .maplibregl-popup-content styles would be missing and the map would render
// as an invisible div.
import 'maplibre-gl/dist/maplibre-gl.css';
import { Providers } from './providers';
import { Nav } from './components/Nav';

export const metadata: Metadata = {
  title: 'Network Inspector',
  description: 'Drivable road network analytics for West African corridors.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen flex flex-col">
        <Providers>
          <Nav />
          <main className="flex-1 flex flex-col">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
