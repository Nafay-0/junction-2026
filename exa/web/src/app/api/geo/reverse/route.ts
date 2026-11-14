/**
 * Coordinates to a place name ("Otaniemi, Espoo, Finland"), for showing the user where the app
 * thinks they are. Uses Photon, the open geocoder built on OpenStreetMap. The lookup goes out
 * from this server, and the coordinates are rounded to about 100 m first: enough to name a
 * neighbourhood, not enough to identify a building.
 */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: "Invalid coordinates." }, { status: 400 });
  }
  try {
    const url = `https://photon.komoot.io/reverse?lat=${lat.toFixed(3)}&lon=${lng.toFixed(3)}&lang=en&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000), headers: { accept: "application/json" } });
    if (!res.ok) return Response.json({}, { status: 200 });
    const data = (await res.json()) as {
      features?: Array<{ properties?: { name?: string; district?: string; locality?: string; city?: string; county?: string; state?: string; country?: string; countrycode?: string } }>;
    };
    const p = data.features?.[0]?.properties;
    if (!p) return Response.json({});
    const city = p.city ?? p.county ?? p.state;
    const area = p.district ?? p.locality;
    const label = [area && area !== city ? area : undefined, city, p.country].filter(Boolean).join(", ");
    return Response.json({ label: label || undefined, city, country: p.countrycode?.toUpperCase() }, { headers: { "cache-control": "private, max-age=600" } });
  } catch {
    // The name is a nicety: without it the app still has the coordinates.
    return Response.json({});
  }
}
