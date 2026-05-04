import { NextResponse } from "next/server";
import { query } from "@/lib/db";

let cache: { data: unknown; ts: number } | null = null;

export async function GET() {
  if (cache && Date.now() - cache.ts < 30000) {
    return NextResponse.json(cache.data);
  }
  try {
    // Get latest status per jet
    const { rows } = await query(
      `SELECT DISTINCT ON (icao24)
         icao24, callsign, on_ground, latitude, longitude, altitude, velocity, heading, ts
       FROM elon_flights
       ORDER BY icao24, ts DESC`
    );
    const jets = rows.map((r: any) => ({
      icao24: r.icao24,
      callsign: r.callsign,
      flying: !r.on_ground,
      lat: r.latitude,
      lon: r.longitude,
      altitude: r.altitude,
      velocity: r.velocity,
      heading: r.heading,
      lastUpdate: r.ts,
    }));
    cache = { data: jets, ts: Date.now() };
    return NextResponse.json(jets);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
