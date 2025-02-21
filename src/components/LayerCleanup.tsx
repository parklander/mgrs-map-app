import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import { AOI } from '@/types/aoi';

export default function LayerCleanup({ aois }: { aois: AOI[] }) {
  const map = useMap();
  
  useEffect(() => {
    return () => {
      // Cleanup all layers when component unmounts
      aois.forEach(aoi => {
        if (aoi.layer) {
          map.removeLayer(aoi.layer);
        }
      });
    };
  }, [map, aois]);

  return null;
}
