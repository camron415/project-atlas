/**
 * Device location for weather / local web search context.
 */
import * as Location from "expo-location";

let cachedContext: string | null = null;
let fetchPromise: Promise<string> | null = null;

export async function getLocationContext(force = false): Promise<string> {
  if (!force && cachedContext !== null) return cachedContext;

  if (!fetchPromise || force) {
    fetchPromise = (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== "granted") return "";

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const places = await Location.reverseGeocodeAsync(position.coords);
        const place = places[0];
        if (!place) return "";

        const parts = [place.city, place.region, place.country].filter(Boolean);
        return parts.join(", ");
      } catch {
        return "";
      }
    })();
  }

  cachedContext = await fetchPromise;
  return cachedContext;
}

export function clearLocationCache(): void {
  cachedContext = null;
  fetchPromise = null;
}
