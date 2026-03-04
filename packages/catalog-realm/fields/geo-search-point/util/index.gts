export interface GeoSearchModel {
  lat?: number | null;
  lon?: number | null;
  searchKey?: string | null;
}

export interface GeoSearchResult {
  lat: number;
  lon: number;
  raw: any;
}

export async function searchAddress(
  query: string,
  limit = 10,
): Promise<GeoSearchResult[]> {
  if (!query || query.trim() === '') return [];

  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      query,
    )}&limit=${limit}`,
  );

  if (!response.ok) {
    throw new Error(`Geocoding search failed: ${response.status}`);
  }

  const data = await response.json();
  if (!Array.isArray(data) || data.length === 0) return [];

  return data
    .map((item: any) => {
      const lat = parseFloat(item.lat);
      const lon = parseFloat(item.lon);
      if (
        Number.isNaN(lat) ||
        Number.isNaN(lon) ||
        lat < -90 ||
        lat > 90 ||
        lon < -180 ||
        lon > 180
      ) {
        return null;
      }
      return { lat, lon, raw: item };
    })
    .filter((item: GeoSearchResult | null): item is GeoSearchResult => !!item);
}

