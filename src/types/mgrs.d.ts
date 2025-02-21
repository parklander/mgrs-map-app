declare module 'mgrs' {
  export function toLatLon(mgrsString: string): { lat: number, lon: number };
  export function forward(lat: number, lon: number): string;
  export function inverse(mgrsString: string): { lat: number, lon: number };
  export function parseGZD(mgrsString: string): string;
  export function getZone(lat: number, lon: number): number;
}
