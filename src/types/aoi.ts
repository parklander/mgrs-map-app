import L from 'leaflet';

export interface AOI {
  id: string;
  mgrsCoordinate: string;
  dimensions: string;
  bounds: [number, number][];
  name: string;
  dateCreated: string;
  layer?: L.Layer;
}
