import L from 'leaflet';

export interface AOI {
  id: string;
  name: string;
  mgrsCoordinate: string;
  dimensions: {
    width: number;
    height: number;
    unit: 'meters' | 'kilometers';
  };
  dateCreated: string | Date;
  color?: string;
  opacity?: number;
  isVisible?: boolean;
  layer?: L.Layer; // Optional Leaflet layer
  bounds?: [number, number, number, number]; // Optional bounds for additional flexibility
}
