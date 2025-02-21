export interface AOI {
  id: string;
  name: string;
  bounds: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
  color?: string;
  opacity?: number;
  isVisible?: boolean;
}
