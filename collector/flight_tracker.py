"""Poll OpenSky Network for Elon's jet status every 5 minutes.

Tracks N628TS (a835af) and N272BG (a2f8db).
Saves status (flying/grounded) to elon_flights table.
"""
from __future__ import annotations

import json
import time
import threading
from typing import Optional

import httpx

# Elon's known jets: tail number → ICAO24 hex
JETS = [
    {"name": "N628TS", "icao24": "a835af"},
    {"name": "N272BG", "icao24": "a2f8db"},
]

POLL_INTERVAL = 300  # 5 minutes
OPENSKY_URL = "https://opensky-network.org/api/states/all"

_db_url: Optional[str] = None
_started = False


def set_db_url(url: str) -> None:
    global _db_url
    _db_url = url


def start() -> None:
    global _started
    if _started:
        return
    _started = True
    t = threading.Thread(target=_loop, name="flight-tracker", daemon=True)
    t.start()


def _get_conn():
    import psycopg2
    conn = psycopg2.connect(_db_url)
    conn.autocommit = True
    return conn


def _loop() -> None:
    client = httpx.Client(timeout=15, headers={"User-Agent": "Mozilla/5.0"})
    conn = _get_conn()

    while True:
        try:
            icao_list = ",".join(j["icao24"] for j in JETS)
            r = client.get(OPENSKY_URL, params={"icao24": icao_list})

            if r.status_code == 200:
                data = r.json()
                states = data.get("states") or []
                now = int(time.time())
                cur = conn.cursor()

                if states:
                    for s in states:
                        # OpenSky state vector format:
                        # [0]=icao24, [1]=callsign, [2]=origin, [3]=time_position,
                        # [4]=last_contact, [5]=longitude, [6]=latitude, [7]=baro_altitude,
                        # [8]=on_ground, [9]=velocity, [10]=true_track, ...
                        icao24 = s[0]
                        callsign = (s[1] or "").strip()
                        on_ground = bool(s[8])
                        lat = s[6]
                        lon = s[5]
                        alt = s[7] or s[13]  # baro or geo altitude
                        vel = s[9]
                        heading = s[10]
                        origin = s[2] or ""

                        cur.execute("""
                            INSERT INTO elon_flights (icao24, callsign, on_ground, latitude, longitude, altitude, velocity, heading, origin, ts, raw)
                            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """, (icao24, callsign, on_ground, lat, lon, alt, vel, heading, origin, now, json.dumps(s)))

                        status = "GROUNDED" if on_ground else "IN FLIGHT"
                        jet_name = next((j["name"] for j in JETS if j["icao24"] == icao24), icao24)
                        print(f"[flight] {jet_name} ({callsign}): {status}")
                else:
                    # No states returned — jets not transmitting (likely grounded)
                    now = int(time.time())
                    for jet in JETS:
                        cur.execute("""
                            INSERT INTO elon_flights (icao24, callsign, on_ground, ts, raw)
                            VALUES (%s, %s, %s, %s, %s)
                        """, (jet["icao24"], jet["name"], True, now, json.dumps({"no_data": True})))

                cur.close()
            elif r.status_code == 429:
                print("[flight] rate limited, backing off")
            else:
                print(f"[flight] HTTP {r.status_code}")

        except Exception as e:
            import psycopg2
            if isinstance(e, psycopg2.OperationalError):
                try:
                    conn.close()
                except Exception:
                    pass
                try:
                    conn = _get_conn()
                    print("[flight] reconnected to DB")
                except Exception:
                    pass
            else:
                print(f"[flight] error: {e}")

        time.sleep(POLL_INTERVAL)
