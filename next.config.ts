import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Cache Components lets /field declare `ensureStatic = 'navigation'`, which
  // makes the build fail if the field app ever stops being fully static.
  // See docs/DECISIONS.md, "Cache Components and ensureStatic".
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
