// Network Inspector — Next.js config.
//
// Reads the top-level .env directly (single source of truth shared with Flask).
// The frontend is a Next.js Node server that proxies /api/* to Flask via rewrites.
// Same-origin from the browser, no CORS needed in normal use.

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../../../.env') });

/** @type {import('next').NextConfig} */
// 127.0.0.1 (not localhost) — avoids IPv6 dual-stack DNS resolution issues on macOS.
// Default port is 5050, NOT 5000 (macOS Control Center / AirPlay Receiver binds 5000).
const FLASK = process.env.FLASK_BACKEND_URL || 'http://127.0.0.1:5050';

const nextConfig = {
  // Next.js 16 blocks cross-origin /_next/* requests by default, which kills
  // HMR when the browser uses 127.0.0.1 but the dev server binds to localhost
  // (or vice versa). Whitelist both forms in dev.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${FLASK}/api/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;
