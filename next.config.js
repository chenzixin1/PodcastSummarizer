/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    // Disable ESLint during builds, we're adding inline disable comments instead
    ignoreDuringBuilds: true,
  },
}

module.exports = nextConfig 