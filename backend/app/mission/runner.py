"""
Runs one mission of misja.py and writes the result as JSON for the 3D view.

    python runner.py OUT.json LAUNCH_UTC LAUNCH_LAT LAUNCH_LON LANDING_LAT LANDING_LON MODE

Run it in its own process (misja.py keeps its state in module globals) and in an empty
working folder: misja.py writes its own CSV/XLSX/PNG/TXT files there too.

Positions are geocentric, rotated from ICRF (Earth's equator) to the ecliptic J2000 frame used
by the solar-system view, so the frontend can add them to the Earth/Moon it already draws.
"""

import json
import math
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
OBLIQUITY = math.radians(23.439291111)  # J2000 obliquity of the ecliptic
COS_E, SIN_E = math.cos(OBLIQUITY), math.sin(OBLIQUITY)


def to_ecliptic(x, y, z):
    """ICRF (equatorial) -> ecliptic J2000, column by column."""
    return x, COS_E * y + SIN_E * z, -SIN_E * y + COS_E * z


def seconds(text):
    """'051:24:09' -> seconds."""
    h, m, s = (int(v) for v in str(text).split(":"))
    return h * 3600 + m * 60 + s


def main():
    out, launch_utc, la_lat, la_lon, ld_lat, ld_lon, mode = sys.argv[1:8]

    # parameters: the project's file + the earliest launch date taken from the mission clock
    params = Path("parametry_misji.py")
    text = (HERE / "parametry_misji.py").read_text(encoding="utf-8")
    params.write_text(f'{text}\n\nEARLIEST_LAUNCH_UTC = "{launch_utc}"\n', encoding="utf-8")

    sys.path.insert(0, str(HERE))
    import misja  # noqa: E402  (imported here: it is heavy and needs the path above)

    res = misja.main(
        str(params),
        launch=(float(la_lat), float(la_lon)),
        landing=(float(ld_lat), float(ld_lon)),
        mode=mode,
        ask=False,
    )

    aux = res["aux"]
    result = {
        "mode": mode,
        "verdict": res["verdict"],
        "landed": bool(res["landed"]),
        "failure": list(res["failure"]) if res["failure"] else None,
        "launch": {"lat": float(la_lat), "lon": float(la_lon)},
        "landing": {"lat": float(ld_lat), "lon": float(ld_lon)},
        # [label, formatted value] rows, as in the program's summary table
        "summary": [[label, misja.fmt_value(value, digits)] for label, value, digits in res["summary"] or []],
        "report": Path(misja.OUTPUT_REPORT).read_text(encoding="utf-8")
        if Path(misja.OUTPUT_REPORT).exists() else "",
        "events": [],
        "trajectory": None,
    }

    if res["events"] is not None and len(res["events"]):
        for _, row in res["events"].iterrows():
            result["events"].append({
                "name": str(row["Event"]),
                "t_s": seconds(row["T+ (hhh:mm:ss)"]),
                "alt_earth_km": float(row["Alt_Earth_km"]),
                "alt_moon_km": float(row["Alt_Moon_km"]),
                "mass_kg": float(row["Mass_kg"]),
            })

    if aux is not None and len(aux):
        import pandas as pd

        utc0 = pd.Timestamp(aux["Date_UTC"].iloc[0]).tz_localize("UTC")
        t0_ms = utc0.value // 1_000_000 - int(round(float(aux["T_plus_s"].iloc[0]) * 1000))

        def cols(prefix):
            x, y, z = (aux[f"{prefix}{a}_geo_km"].to_numpy() for a in "XYZ")
            return to_ecliptic(x, y, z)

        rx, ry, rz = cols("")
        mx, my, mz = cols("Moon_")
        sx, sy, sz = cols("Site_")
        sx, sy, sz = sx - mx, sy - my, sz - mz  # landing site relative to the Moon's centre

        phases = list(dict.fromkeys(aux["Phase"]))
        index = {p: i for i, p in enumerate(phases)}
        r1 = lambda a: [round(float(v), 1) for v in a]  # noqa: E731
        result["trajectory"] = {
            "launch_ms": int(t0_ms),
            "phases": phases,
            "t_s": [round(float(v), 2) for v in aux["T_plus_s"]],
            "phase": [index[p] for p in aux["Phase"]],
            "alt_earth_km": r1(aux["Altitude_Earth_km"]),
            "alt_moon_km": r1(aux["Altitude_Moon_km"]),
            "speed_km_s": [round(float(v), 4) for v in aux["Speed_geocentric_km_s"]],
            "mass_kg": [round(float(v)) for v in aux["Mass_kg"]],
            # geocentric, ecliptic J2000 [km]
            "r": [r1(rx), r1(ry), r1(rz)],
            "moon": [r1(mx), r1(my), r1(mz)],
            # landing site relative to the Moon's centre, ecliptic J2000 [km]
            "site": [r1(sx), r1(sy), r1(sz)],
        }

    Path(out).write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    # misja.py prints non-ASCII text (Δ, °); make sure the console encoding never breaks the run
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    try:
        main()
    except Exception as error:  # noqa: BLE001 - reported to the user
        print(f"ERROR: {type(error).__name__}: {re.sub(r'\s+', ' ', str(error))}", flush=True)
        raise
