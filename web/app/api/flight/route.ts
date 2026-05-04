import { NextResponse } from "next/server";

export async function GET() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);

    const r = await fetch(
      "https://opensky-network.org/api/states/all?icao24=a835af&icao24=a2f8db",
      { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0" } }
    );
    clearTimeout(timeout);

    if (!r.ok) return NextResponse.json({ states: null, time: Math.floor(Date.now() / 1000) });

    const d = await r.json();
    return NextResponse.json(d);
  } catch {
    // OpenSky unreachable — return grounded status
    return NextResponse.json({ states: null, time: Math.floor(Date.now() / 1000) });
  }
}
