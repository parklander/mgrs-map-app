'use client';

import { useEffect } from 'react';
import { FeatureGroup } from 'react-leaflet';
import { EditControl } from 'react-leaflet-draw';

interface DrawingControlsProps {
  onCreated: (e: any) => void;
}

export default function DrawingControls({ onCreated }: DrawingControlsProps) {
  useEffect(() => {
    // Import leaflet-draw on the client side
    require('leaflet-draw');
  }, []);

  return (
    <FeatureGroup>
      <EditControl
        position="topright"
        onCreated={onCreated}
        draw={{
          rectangle: true,
          polygon: true,
          circle: false,
          circlemarker: false,
          marker: false,
          polyline: false,
        }}
      />
    </FeatureGroup>
  );
}
