/** @type {import('next').NextConfig} */
const nextConfig = {
  // Self-contained Node server in `.next/standalone/server.js`. Lets the
  // Docker runtime image ship only that plus `.next/static` and `public/`,
  // skipping `node_modules` and source files. ~150 MB final image instead
  // of ~1 GB.
  output: "standalone",
};

export default nextConfig;
