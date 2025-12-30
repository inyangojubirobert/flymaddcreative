/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  
  // Environment variables that should be available to the client
  env: {
    CUSTOM_KEY: 'my-value',
  },
  
  // Image optimization configuration
  images: {
    domains: [
      'localhost',
      'your-domain.com',
    ],
  },
  
  // Redirects for SEO and user experience
  async redirects() {
    return [
      {
        source: '/onedream/home',
        destination: '/onedream',
        permanent: true,
      },
    ];
  },
  
  // Rewrites for clean URLs
  async rewrites() {
    return [
      {
        source: '/onedream/r/:token',
        destination: '/onedream/ref/:token',
      },
      // Rewrite .html requests to public folder
      {
        source: '/:path*.html',
        destination: '/:path*.html',
      },
    ];
  },
  
  // Headers for security and performance
  async headers() {
    return [
      {
        source: '/onedream/:path*',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },
  
  // Webpack configuration for custom setups
  webpack: (config, { buildId, dev, isServer, defaultLoaders, webpack }) => {
    // Custom webpack configuration if needed
    return config;
  },
  
  // Experimental features
  experimental: {
    // Enable app directory if migrating to App Router in future
    // appDir: true,
  },
  
  // Allow static HTML files in public folder
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
};

module.exports = nextConfig;