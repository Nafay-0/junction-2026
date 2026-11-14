import { requireUser } from "@/lib/auth/server";
/**
 * Coordinates to a place name ("Otaniemi, Espoo, Finland"), for showing the user where the app
 * thinks they are. Two open geocoders built on OpenStreetMap are tried in turn: Photon first,
 * then Nominatim if Photon is slow or has nothing. The lookup goes out from this server, and the
 * coordinates are rounded to about 100 m first: enough to name a neighbourhood, not enough to
 * identify a building.
 */

type Named = { label?: string; city?: string; country?: string };

const join = (...parts: Array<string | undefined>) => parts.filter(Boolean).join(", ") || undefined;

async function photon(lat: string, lng: string): Promise<Named> {
  const res = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lng}&lang=en&limit=1`, {
    signal: AbortSignal.timeout(3500),
    headers: { accept: "application/json" },
  });
  if (!res.ok) return {};
  const data = (await res.json()) as {
    features?: Array<{ properties?: { district?: string; locality?: string; city?: string; county?: string; state?: string; country?: string; countrycode?: string } }>;
  };
  const p = data.features?.[0]?.properties;
  if (!p) return {};
  const city = p.city ?? p.county ?? p.state;
  const area = p.district ?? p.locality;
  return { label: join(area && area !== city ? area : undefined, city, p.country), city, country: p.countrycode?.toUpperCase() };
}

async function nominatim(lat: string, lng: string): Promise<Named> {
  const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=14&accept-language=en`, {
    signal: AbortSignal.timeout(4000),
    // Nominatim asks every client to identify its application.
    headers: { accept: "application/json", "user-agent": "hovi-butler-demo/0.1" },
  });
  if (!res.ok) return {};
  const data = (await res.json()) as {
    address?: { suburb?: string; neighbourhood?: string; quarter?: string; city_district?: string; city?: string; town?: string; village?: string; municipality?: string; county?: string; country?: string; country_code?: string };
  };
  const a = data.address;
  if (!a) return {};
  const city = a.city ?? a.town ?? a.village ?? a.municipality ?? a.county;
  const area = a.suburb ?? a.neighbourhood ?? a.quarter ?? a.city_district;
  return { label: join(area && area !== city ? area : undefined, city, a.country), city, country: a.country_code?.toUpperCase() };
}

export async function GET(req: Request) {
  const user = await requireUser();
  if (user instanceof Response) return user;
  const params = new URL(req.url).searchParams;
  const latNum = Number(params.get("lat"));
  const lngNum = Number(params.get("lng"));
  if (!params.get("lat") || !params.get("lng") || !Number.isFinite(latNum) || !Number.isFinite(lngNum) || Math.abs(latNum) > 90 || Math.abs(lngNum) > 180) {
    return Response.json({ error: "Invalid coordinates." }, { status: 400 });
  }
  const lat = latNum.toFixed(3);
  const lng = lngNum.toFixed(3);
  for (const lookup of [photon, nominatim]) {
    try {
      const named = await lookup(lat, lng);
      if (named.label) return Response.json(named, { headers: { "cache-control": "private, max-age=600" } });
    } catch {
      /* try the next one */
    }
  }
  // The name is a nicety: without it the app still has the coordinates and says "Your location".
  return Response.json({});
}
