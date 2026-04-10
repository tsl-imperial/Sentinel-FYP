import type { Metadata } from 'next';
import './globals.css';
// Leaflet CSS at the root layout: dynamic-import chains don't reliably pull
// node_modules CSS into the page's CSS chunk, so the .leaflet-container styles
// would be missing and the map would render as an invisible div.
import 'leaflet/dist/leaflet.css';
import { Providers } from './providers';
import { Nav } from './components/Nav';
import { Footer } from './components/Footer';

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
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
