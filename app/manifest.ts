import type { MetadataRoute } from 'next';

/** Web app manifest: installs the inspector's app, opening straight into /field. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/field',
    name: 'Field Inspections',
    short_name: 'Inspections',
    description: 'Offline-first safety inspections. A demo project.',
    start_url: '/field',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#0b5cad',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
