export interface GeoModel {
  lat?: number | null;
  lon?: number | null;
  searchKey?: string | null;
}

export function hasValidCoordinates(model: GeoModel | null | undefined): boolean {
  if (!model) return false;
  const { lat, lon } = model;
  return (
    lat != null &&
    lon != null &&
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    !isNaN(lat) &&
    !isNaN(lon)
  );
}

export function formatCoordinates(
  lat: number | null | undefined,
  lon: number | null | undefined,
  precision?: number,
): string {
  if (lat == null || lon == null) return 'No coordinates';
  const p = precision ?? 6;
  return `${lat.toFixed(p)}, ${lon.toFixed(p)}`;
}

export async function geocodeLocation(
  query: string,
): Promise<{ lat: number; lon: number } | null> {
  if (!query || query.trim() === '') return null;

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
  );

  if (!response.ok) {
    throw new Error(`Geocoding failed: ${response.status}`);
  }

  const data = await response.json();
  if (!data || data.length === 0) return null;

  const lat = parseFloat(data[0].lat);
  const lon = parseFloat(data[0].lon);

  if (
    isNaN(lat) ||
    isNaN(lon) ||
    lat < -90 ||
    lat > 90 ||
    lon < -180 ||
    lon > 180
  ) {
    return null;
  }

  return { lat, lon };
}
