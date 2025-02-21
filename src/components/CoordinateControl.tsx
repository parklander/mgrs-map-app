'use client';

import { useEffect, useState } from 'react';
import { useMap } from 'react-leaflet';
import * as mgrs from 'mgrs';
import L from 'leaflet';

export default function CoordinateControl() {
  const [coordinate, setCoordinate] = useState('');
  const map = useMap();

  useEffect(() => {
    // Create a custom control
    const CoordinateControl = L.Control.extend({
      onAdd: () => {
        const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control coordinate-control');
        container.style.background = 'white';
        container.style.padding = '5px 10px';
        container.style.margin = '10px';
        container.style.border = '2px solid rgba(0,0,0,0.2)';
        container.style.borderRadius = '4px';
        container.style.fontSize = '12px';
        container.style.fontFamily = 'monospace';
        container.style.color = '#333';
        container.innerHTML = 'MGRS: ';
        return container;
      }
    });

    const control = new CoordinateControl({ position: 'bottomleft' });
    control.addTo(map);

    // Update coordinate on mousemove
    const updateCoordinate = (e: L.LeafletMouseEvent) => {
      try {
        // Convert to MGRS
        const mgrsCoord = mgrs.forward(e.latlng.lat, e.latlng.lng);
        setCoordinate(mgrsCoord);
        
        // Update control content
        const container = control.getContainer();
        if (container) {
          container.innerHTML = `<strong style="color: #333">MGRS:</strong> <span style="color: #333">${mgrsCoord}</span>`;
        }
      } catch (error) {
        console.error('Error converting coordinates:', error);
      }
    };

    map.on('mousemove', updateCoordinate);

    return () => {
      map.off('mousemove', updateCoordinate);
      map.removeControl(control);
    };
  }, [map]);

  return null;
}
