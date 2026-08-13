import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        /**
         * The service worker must never be served from cache.
         *
         * Files in `public/` are otherwise cached aggressively, and a stale
         * `sw.js` is the worst kind of bug to ship: the browser keeps running
         * last week's worker, which keeps serving last week's rules, and no
         * deploy can dislodge it. `must-revalidate` with a zero lifetime means
         * every load checks, and the check is one small conditional request.
         */
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
