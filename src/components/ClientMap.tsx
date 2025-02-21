'use client';

import dynamic from 'next/dynamic';

// Dynamically import Map with no SSR
const Map = dynamic(() => import('./Map'), {
  ssr: false,
  loading: () => (
    <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
      <div className="text-gray-600">Loading map...</div>
    </div>
  ),
});

export default function ClientMap() {
  return <Map />;
}
