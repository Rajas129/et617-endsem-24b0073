/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // C1: no image optimisation pipeline because the app ships no images at all.
  poweredByHeader: false,
};
export default nextConfig;
