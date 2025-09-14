/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  env: {
    API_BASE_URL: process.env.API_BASE_URL || 'https://aimelia-api.onrender.com',
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${process.env.API_BASE_URL || 'https://aimelia-api.onrender.com'}/:path*`,
      },
    ]
  },
}

module.exports = nextConfig
