"""
MISJA NA KSIĘŻYC - symulacja lotu i ocena wykonalności

Uruchomienie:
    python misja.py                      (parametry z parametry_misji.py, program
                                          zapyta o punkt startu, lądowania i tryb)
    python misja.py moje_parametry.py    (inny plik z parametrami)

    bez pytań, wszystko z linii poleceń:
    python misja.py --start 28.6084 -80.6043 --ladowanie 0.674 23.473 --tryb oba
    python misja.py --bez-pytan          (wszystko z pliku parametrów)

    z innego programu / Jupytera:
    main("parametry_misji.py", launch=(52.2, 21.0), landing=(-43.3, -11.2), mode="szybki")

Program pobiera od użytkownika:
  - punkt startu na Ziemi (szerokość i długość geograficzna),
  - punkt lądowania na Księżycu (szerokość i długość selenograficzna),
  - tryb misji:
      oszczedny - najmniejsze zużycie paliwa: wolniejszy lot (ok. 4 dni),
                  czas lotu wydłużany, dopóki daje to zauważalną oszczędność;
      szybki    - najkrótszy realistyczny czas dolotu: najszybszy lot, na jaki
                  starcza paliwa rakiety i statku z zachowaniem rezerw
                  (zapas w ostatnim członie, Δv statku na powrót na Ziemię);
      oba       - liczy oba tryby i zestawia je w tabeli porównawczej;
      wlasny    - czas lotu wpisany w pliku parametrów (TLI["time_of_flight_h"]).
Dla wybranych punktów program sam dobiera azymut startu i okno startowe,
a potem przelicza trajektorię, Δv i paliwo na każdym etapie.

Wszystkie pozostałe dane wejściowe (rakieta, statek, profil lotu, ustawienia
trybów) są w pliku parametry_misji.py - tego pliku nie trzeba edytować.

Etapy:
  1. Okno startowe  - azymut startu (domyślnie dobierany automatycznie: jak
                      najbliżej kierunku wschodniego) i chwila startu, w której
                      płaszczyzna orbity zawiera Księżyc w chwili przylotu
                      (poprawiana iteracyjnie).
  2. Start          - dowolna liczba członów, ciąg zależny od ciśnienia, opór,
                      obrót Ziemi; naprowadzanie: pionowo -> pochylenie ->
                      zwrot grawitacyjny -> "linear tangent" do orbity parkingowej.
  3. TLI            - ostatni człon; moment zapłonu i czas pracy dobierane tak,
                      by dolecieć do Księżyca w czasie wybranym przez tryb misji.
  4. MCC            - korekta kursu silnikiem statku: ustawia wysokość przelotu
                      i płaszczyznę orbity tak, by przechodziła nad lądowiskiem.
  5. LOI            - hamowanie w peryselenium, wejście na orbitę Księżyca.
  6. DOI            - odłączenie lądownika, obniżenie peryselenium (~15 km).
  7. Lądowanie      - naprowadzanie ZEM/ZEV przez punkty "high gate" i "low gate"
                      (jak w Apollo), z ograniczeniami ciągu i paliwa.

Na każdym etapie sprawdzane jest paliwo; program podaje werdykt
"czy doleci i wyląduje", bilans Δv i paliwa oraz przyczynę ewentualnego niepowodzenia.

Fizyka: grawitacja Ziemi (+J2), Księżyca i Słońca w każdej fazie lotu,
efemerydy NASA JPL Horizons (ICRF), orientacja Księżyca wg modelu IAU.
Uproszczenia: atmosfera wykładnicza, Księżyc jako kula (bez rzeźby terenu
i anomalii grawitacyjnych), korekta kursu jako impuls.

Wyniki (prefiks z OUTPUT_PREFIX; w trybie "oba" każdy tryb ma własne pliki:
misja_oszczedny_*, misja_szybki_* oraz wspólne misja_porownanie.csv):
    *_trajektoria.csv      - położenie i prędkość w ICRF względem barycentrum
    *_trajektoria_geo.csv  - dane dla podglądu (podglad_lotu.py)
    *_wyniki.xlsx          - werdykt, podsumowanie, bilans Δv, zdarzenia, trajektoria
    *_wykres.png, *_raport.txt

Wymagane biblioteki:  pip install numpy pandas scipy astropy requests matplotlib openpyxl
Opcjonalnie:          pip install xlsxwriter   (kilka razy szybszy zapis pliku Excel)

Szybkość: całkowanie liczy na zwykłych liczbach zmiennoprzecinkowych (bez małych tablic
numpy), a poszukiwania (TLI, korekta kursu, lądowanie) używają modelu 2 ciał jako
przybliżenia startowego i kończą pracę po osiągnięciu zadanej dokładności. Efemerydy
z Horizons są pobierane równolegle i zapisywane obok programu (efemerydy_horizons_*.npz) -
kolejne uruchomienia z tą samą datą startu nie wymagają internetu. Plik można skasować.
"""

import csv
import math
import os
from io import StringIO

import numpy as np
import pandas as pd
import requests
from scipy.integrate import solve_ivp
from scipy.interpolate import CubicHermiteSpline
from scipy.optimize import brentq, least_squares, minimize_scalar

import astropy.units as u
from astropy.coordinates import EarthLocation, get_body_barycentric
from astropy.time import Time


# ============================================================
# WCZYTYWANIE PARAMETRÓW (z pliku parametry_misji.py)
# ============================================================

def load_parameters(path):
    """Wczytuje parametry misji z pliku .py do zmiennych globalnych programu."""

    import importlib.util
    import os

    if not os.path.isfile(path):
        here = os.path.dirname(os.path.abspath(globals().get("__file__", "")) or ".")
        alt = os.path.join(here, os.path.basename(path))
        if os.path.isfile(alt):
            path = alt
        else:
            raise FileNotFoundError(
                f"Parameter file not found: '{path}'. Put parametry_misji.py "
                f"in the same folder (current folder: {os.getcwd()}) "
                "or give the full path: main(r'C:\\...\\parametry_misji.py')."
            )

    spec = importlib.util.spec_from_file_location("parametry_misji_user", path)
    if spec is None or spec.loader is None:
        raise ValueError(f"The parameter file must have the .py extension: '{path}'")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    g = globals()
    for key in dir(mod):
        if key.isupper():
            value = getattr(mod, key)
            g[key] = dict(value) if isinstance(value, dict) else value   # kopie: program je zmienia

    # ustawienia, których może nie być w starszych plikach parametrów
    user = vars(mod)
    g["AZIMUTH_SETTING"] = user.get("LAUNCH_AZIMUTH_DEG", "auto")   # "auto" lub liczba
    g["LAUNCH_AZIMUTH_DEG"] = g["AZIMUTH_SETTING"]
    g["MISSION_MODE"] = user.get("MISSION_MODE", "wlasny")
    g["ASK_USER"] = user.get("ASK_USER", True)
    g["MODE_SETTINGS"] = {**DEFAULT_MODE_SETTINGS, **user.get("MODE_SETTINGS", {})}
    g["TOF_USER_H"] = float(g["TLI"]["time_of_flight_h"])           # czas lotu dla trybu "wlasny"

    # wielkości pochodne
    g["PAYLOAD"]["mass_kg"] = CSM["mass_kg"] + LANDER["mass_kg"]
    g["SPACECRAFT_ENGINE"] = {
        "name": "SPS",
        "thrust_N": CSM["thrust_N"],
        "isp_s": CSM["isp_s"],
        "propellant_kg": CSM["propellant_kg"],
    }
    g["OUTPUT_PREFIX"] = g.get("OUTPUT_PREFIX", "misja")
    set_output_names(g["OUTPUT_PREFIX"])
    _refresh_constants()


def set_output_names(prefix):
    """Nazwy plików wynikowych dla danego prefiksu (każdy tryb misji ma własne pliki)."""
    g = globals()
    g["OUTPUT_CSV"] = f"{prefix}_trajektoria.csv"
    g["OUTPUT_AUX_CSV"] = f"{prefix}_trajektoria_geo.csv"
    g["OUTPUT_XLSX"] = f"{prefix}_wyniki.xlsx"
    g["OUTPUT_PNG"] = f"{prefix}_wykres.png"
    g["OUTPUT_REPORT"] = f"{prefix}_raport.txt"


# Ustawienia trybów misji (można je nadpisać słownikiem MODE_SETTINGS w pliku parametrów)
DEFAULT_MODE_SETTINGS = {
    "economy_tof_max_h": 120.0,          # tryb oszczędny: najdłuższy dopuszczalny lot
    "economy_min_gain_kg_per_h": 10.0,   # ...wydłużaj lot, dopóki godzina dłużej oszczędza tyle paliwa
    "fast_tof_min_h": 36.0,              # tryb szybki: najkrótszy dopuszczalny lot
    "fast_max_passes": 4,                # ...ile razy wolno powtórzyć obliczenia, szukając granicy
    "fast_tolerance_h": 0.25,            # ...z jaką dokładnością szukać najkrótszego lotu
    "last_stage_reserve_pct": 1.0,       # zapas paliwa ostatniego członu po TLI [% jego paliwa]
    "return_reserve_dv_m_s": 1000.0,     # Δv, które statek musi zachować na powrót na Ziemię
}


# ============================================================
# STAŁE FIZYCZNE
# ============================================================

G0 = 9.80665                    # m/s²
MU_EARTH = 398600.4418          # km³/s²
MU_MOON = 4902.800066
MU_SUN = 1.32712440018e11
R_EARTH = 6378.137              # km
R_MOON = 1737.4
J2_EARTH = 1.08262668e-3
OMEGA_EARTH = 7.2921159e-5      # rad/s
OMEGA_VEC = np.array([0.0, 0.0, OMEGA_EARTH])   # zastępowane osią obrotu z dnia startu (Ascent)
EARTH_POLE = np.array([0.0, 0.0, 1.0])

ATM_RHO0 = 1.225                # kg/m³
ATM_SCALE_H = 7.2               # km
ATM_TOP_KM = 120.0

API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"


# ============================================================
# EFEMERYDY
# ============================================================

def horizons_vectors(command, center, jd_start, jd_stop, step):
    """Wektory stanu z Horizons (ICRF, km, km/s, TDB)."""

    start = Time(jd_start, format="jd", scale="tdb").iso[:16]
    stop = Time(jd_stop, format="jd", scale="tdb").iso[:16]

    params = {
        "format": "json",
        "COMMAND": f"'{command}'",
        "OBJ_DATA": "'NO'",
        "MAKE_EPHEM": "'YES'",
        "EPHEM_TYPE": "'VECTORS'",
        "CENTER": f"'{center}'",
        "START_TIME": f"'{start}'",
        "STOP_TIME": f"'{stop}'",
        "STEP_SIZE": f"'{step}'",
        "REF_PLANE": "'FRAME'",
        "REF_SYSTEM": "'ICRF'",
        "OUT_UNITS": "'KM-S'",
        "VEC_TABLE": "'2'",
        "VEC_CORR": "'NONE'",
        "VEC_LABELS": "'NO'",
        "CSV_FORMAT": "'YES'",
        "TIME_TYPE": "'TDB'",
    }

    response = requests.get(API_URL, params=params, timeout=120)
    response.raise_for_status()
    result = response.json()

    if "error" in result:
        raise RuntimeError(result["error"])

    data = result["result"]
    if "$$SOE" not in data:
        raise RuntimeError("No ephemeris data.")
    data = data.split("$$SOE")[1].split("$$EOE")[0]

    rows = []
    for row in csv.reader(StringIO(data)):
        row = [x.strip() for x in row if x.strip() != ""]
        if len(row) < 8:
            continue
        try:
            rows.append([float(row[0])] + [float(x) for x in row[2:8]])
        except ValueError:
            continue

    arr = np.array(rows)
    return arr[:, 0], arr[:, 1:4], arr[:, 4:7]


def astropy_vectors(jd):
    """Zapasowe efemerydy z astropy (offline, mniej dokładne)."""

    t = Time(jd, format="jd", scale="tdb")
    dt = 60.0 * u.s

    def bary(body, tt):
        return get_body_barycentric(body, tt, ephemeris="builtin").xyz.to(u.km).value.T

    out = {}
    for body in ("earth", "moon", "sun"):
        r = bary(body, t)
        v = (bary(body, t + dt) - bary(body, t - dt)) / (2 * dt.value)
        out[body] = (r, v)

    er, ev = out["earth"]
    return {
        "moon": (out["moon"][0] - er, out["moon"][1] - ev),   # geocentryczny
        "sun": (out["sun"][0] - er, out["sun"][1] - ev),      # geocentryczny
        "earth": (er, ev),                                    # barycentryczny
    }


class FastHermite:
    """Szybka interpolacja Hermite'a na równomiernej siatce czasu."""

    def __init__(self, s, r, v):
        spline = CubicHermiteSpline(s, r, v, axis=0)
        self.spline = spline
        self.deriv = spline.derivative()
        self.s0 = s[0]
        self.h = s[1] - s[0]
        self.n = len(s) - 1
        self.c = spline.c            # (4, n, 3): współczynniki wielomianów
        self.x = spline.x
    def __call__(self, t):
        if np.ndim(t) == 0:
            i = int((t - self.s0) / self.h)
            i = 0 if i < 0 else (self.n - 1 if i >= self.n else i)
            ds = t - self.x[i]
            c = self.c
            return ((c[0, i] * ds + c[1, i]) * ds + c[2, i]) * ds + c[3, i]
        return self.spline(t)

    def velocity(self, t):
        if np.ndim(t) == 0:
            i = int((t - self.s0) / self.h)
            i = 0 if i < 0 else (self.n - 1 if i >= self.n else i)
            ds = t - self.x[i]
            c = self.c
            return (3 * c[0, i] * ds + 2 * c[1, i]) * ds + c[2, i]
        return self.deriv(t)


class Ephemeris:
    """Interpolacja Hermite'a położeń; czas w sekundach od jd0 (TDB)."""

    def __init__(self, jd, data, source):
        self.jd0 = jd[0]
        self.source = source
        s = (jd - jd[0]) * 86400.0
        self.t_min, self.t_max = s[0], s[-1]
        self.moon = FastHermite(s, data["moon"][0], data["moon"][1])
        self.sun = FastHermite(s, data["sun"][0], data["sun"][1])
        self.earth = FastHermite(s, data["earth"][0], data["earth"][1])
        self.moon_v = self.moon.velocity
        self.earth_v = self.earth.velocity

        # tablice współczynników w zwykłych listach Pythona - szybkie obliczenia skalarne
        self._s0 = float(s[0])
        self._inv_h = 1.0 / float(s[1] - s[0])
        self._n = len(s) - 1
        self._x = [float(v) for v in self.moon.x]
        self._tm = self._table(self.moon)
        self._ts = self._table(self.sun)

    @staticmethod
    def _table(fh):
        """Współczynniki wielomianów (4, n, 3) -> lista n wierszy po 12 liczb: [k * 3 + składowa]."""
        return np.ascontiguousarray(np.transpose(fh.c, (1, 0, 2))).reshape(-1, 12).tolist()

    def _index(self, t):
        i = int((t - self._s0) * self._inv_h)
        if i < 0:
            return 0
        return self._n - 1 if i >= self._n else i

    def third_body(self, t):
        """(xm, ym, zm, xs, ys, zs): położenie Księżyca i Słońca względem Ziemi [km] w chwili t."""
        i = self._index(t)
        ds = t - self._x[i]
        m = self._tm[i]
        s = self._ts[i]
        return (((m[0] * ds + m[3]) * ds + m[6]) * ds + m[9],
                ((m[1] * ds + m[4]) * ds + m[7]) * ds + m[10],
                ((m[2] * ds + m[5]) * ds + m[8]) * ds + m[11],
                ((s[0] * ds + s[3]) * ds + s[6]) * ds + s[9],
                ((s[1] * ds + s[4]) * ds + s[7]) * ds + s[10],
                ((s[2] * ds + s[5]) * ds + s[8]) * ds + s[11])

    def moon_pv(self, t):
        """(x, y, z, vx, vy, vz): położenie [km] i prędkość [km/s] Księżyca względem Ziemi."""
        i = self._index(t)
        ds = t - self._x[i]
        m = self._tm[i]
        return (((m[0] * ds + m[3]) * ds + m[6]) * ds + m[9],
                ((m[1] * ds + m[4]) * ds + m[7]) * ds + m[10],
                ((m[2] * ds + m[5]) * ds + m[8]) * ds + m[11],
                (3 * m[0] * ds + 2 * m[3]) * ds + m[6],
                (3 * m[1] * ds + 2 * m[4]) * ds + m[7],
                (3 * m[2] * ds + 2 * m[5]) * ds + m[8])

    def bodies(self, t):
        """Księżyc (położenie, prędkość) i Słońce (położenie): 9 liczb."""
        i = self._index(t)
        ds = t - self._x[i]
        m = self._tm[i]
        s = self._ts[i]
        return (((m[0] * ds + m[3]) * ds + m[6]) * ds + m[9],
                ((m[1] * ds + m[4]) * ds + m[7]) * ds + m[10],
                ((m[2] * ds + m[5]) * ds + m[8]) * ds + m[11],
                (3 * m[0] * ds + 2 * m[3]) * ds + m[6],
                (3 * m[1] * ds + 2 * m[4]) * ds + m[7],
                (3 * m[2] * ds + 2 * m[5]) * ds + m[8],
                ((s[0] * ds + s[3]) * ds + s[6]) * ds + s[9],
                ((s[1] * ds + s[4]) * ds + s[7]) * ds + s[10],
                ((s[2] * ds + s[5]) * ds + s[8]) * ds + s[11])

    def sec(self, jd_tdb):
        return (jd_tdb - self.jd0) * 86400.0

    def jd(self, sec):
        return self.jd0 + np.asarray(sec) / 86400.0


def _ephemeris_cache_file(jd_start, jd_stop, step):
    """Plik z zapisanymi efemerydami Horizons dla danego zakresu (obok programu)."""
    import hashlib
    key = f"{jd_start:.6f}|{jd_stop:.6f}|{step}"
    name = "efemerydy_horizons_" + hashlib.md5(key.encode()).hexdigest()[:12] + ".npz"
    here = os.path.dirname(os.path.abspath(globals().get("__file__", ""))) or "."
    return os.path.join(here, name)


def load_ephemeris(jd_start, jd_stop):

    step = SIMULATION["ephemeris_step"]

    if EPHEMERIS_SOURCE in ("auto", "horizons"):
        cache = _ephemeris_cache_file(jd_start, jd_stop, step)
        try:
            if os.path.isfile(cache):
                z = np.load(cache)
                print(f"JPL Horizons ephemeris from the local cache ({os.path.basename(cache)}).")
                return Ephemeris(z["jd"], {"moon": (z["mr"], z["mv"]), "sun": (z["sr"], z["sv"]),
                                           "earth": (z["er"], z["ev"])}, "JPL Horizons")
        except Exception:
            pass                                    # uszkodzony plik - pobierz jeszcze raz
        try:
            print("Downloading ephemeris from NASA JPL Horizons...")
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=3) as pool:      # trzy niezależne zapytania naraz
                f_moon = pool.submit(horizons_vectors, "301", "500@399", jd_start, jd_stop, step)
                f_sun = pool.submit(horizons_vectors, "10", "500@399", jd_start, jd_stop, step)
                f_earth = pool.submit(horizons_vectors, "399", "500@0", jd_start, jd_stop, step)
                jd, mr, mv = f_moon.result()
                _, sr, sv = f_sun.result()
                _, er, ev = f_earth.result()
            print(f"OK - {len(jd)} points per body.")
            try:
                np.savez(cache, jd=jd, mr=mr, mv=mv, sr=sr, sv=sv, er=er, ev=ev)
            except OSError:
                pass                                # brak prawa zapisu - po prostu bez pamięci podręcznej
            return Ephemeris(
                jd, {"moon": (mr, mv), "sun": (sr, sv), "earth": (er, ev)}, "JPL Horizons"
            )
        except Exception as error:
            if EPHEMERIS_SOURCE == "horizons":
                raise
            print(f"Horizons unavailable ({type(error).__name__}) - using astropy.")

    hours = 1.0
    jd = np.arange(jd_start, jd_stop + 1e-9, hours / 24.0)
    return Ephemeris(jd, astropy_vectors(jd), "astropy (builtin)")


# ============================================================
# MODEL FIZYCZNY
# ============================================================

EPH = None   # ustawiane w main()


def accel_xyz(x, y, z, mx, my, mz, sx, sy, sz):
    """
    Przyspieszenie grawitacyjne [km/s²] w układzie geocentrycznym (osie ICRF), liczone na
    liczbach skalarnych: Ziemia (+J2) oraz Księżyc i Słońce (z członem pośrednim, bo środek
    układu to Ziemia). (mx..) i (sx..) to położenia Księżyca i Słońca względem Ziemi.
    """
    r2 = x * x + y * y + z * z
    rn = _sqrt(r2)
    f = -MU_EARTH / (r2 * rn)
    k = K_J2 / (r2 * r2 * rn)
    zz = 5.0 * z * z / r2
    kxy = k * (zz - 1.0)
    ax = (f + kxy) * x
    ay = (f + kxy) * y
    az = (f + k * (zz - 3.0)) * z

    dx = mx - x
    dy = my - y
    dz = mz - z
    dn = _sqrt(dx * dx + dy * dy + dz * dz)
    rb = _sqrt(mx * mx + my * my + mz * mz)
    fd = MU_MOON / (dn * dn * dn)
    fb = MU_MOON / (rb * rb * rb)
    ax += fd * dx - fb * mx
    ay += fd * dy - fb * my
    az += fd * dz - fb * mz

    dx = sx - x
    dy = sy - y
    dz = sz - z
    dn = _sqrt(dx * dx + dy * dy + dz * dz)
    rb = _sqrt(sx * sx + sy * sy + sz * sz)
    fd = MU_SUN / (dn * dn * dn)
    fb = MU_SUN / (rb * rb * rb)
    return ax + fd * dx - fb * sx, ay + fd * dy - fb * sy, az + fd * dz - fb * sz


def gravity_xyz(t, x, y, z):
    """Jak accel_xyz, ale położenia Księżyca i Słońca bierze z efemeryd."""
    mx, my, mz, sx, sy, sz = EPH.third_body(t)
    return accel_xyz(x, y, z, mx, my, mz, sx, sy, sz)


def gravity(t, r):
    """Przyspieszenie grawitacyjne w układzie geocentrycznym (osie ICRF) [km/s²]."""
    return np.array(gravity_xyz(float(t), float(r[0]), float(r[1]), float(r[2])))


F_EARTH = 1 / 298.257223563     # spłaszczenie Ziemi

# ------------------------------------------------------------------------------------
# SZYBKIE FUNKCJE SKALARNE
# Całkowanie wywołuje funkcję prawych stron setki tysięcy razy; małe tablice numpy
# (np.array, np.cross, np.linalg.norm) kosztują tam więcej niż sama arytmetyka,
# dlatego gorące ścieżki liczą na zwykłych liczbach zmiennoprzecinkowych.
# Wektory sterujące mają postać krotek (x, y, z).
# ------------------------------------------------------------------------------------

_sqrt = math.sqrt
_exp = math.exp
_cos = math.cos
_sin = math.sin
K_J2 = 1.5 * J2_EARTH * MU_EARTH * R_EARTH ** 2     # stała członu J2 (odświeżana po wczytaniu parametrów)
FLYBY_CUTOFF_KM = 25_000.0      # po oddaleniu się na tyle od Księżyca dalsza propagacja jest zbędna


def _refresh_constants():
    global K_J2
    K_J2 = 1.5 * J2_EARTH * MU_EARTH * R_EARTH ** 2


def altitude(r):
    """Wysokość nad elipsoidą (przybliżenie) [km]; działa też dla tablic (N, 3)."""
    r = np.asarray(r)
    rn = np.linalg.norm(r, axis=-1)
    sin_lat = (r @ EARTH_POLE) / rn
    return rn - R_EARTH * (1 - F_EARTH * sin_lat ** 2)


def pressure_ratio(h_km):
    return math.exp(-h_km / ATM_SCALE_H) if h_km < ATM_TOP_KM else 0.0


def stage_mdot(stage):
    return stage["thrust_vac_N"] / (stage["isp_vac_s"] * G0)


def make_rhs(engine=None, steer=None, drag=False):
    """
    engine: dict z 'thrust_vac_N', 'isp_vac_s', 'isp_sl_s' (lub None)
    steer:  funkcja (t, x, y, z, vx, vy, vz) -> krotka (ux, uy, uz) - wektor jednostkowy ciągu
    Stan y = [x, y, z, vx, vy, vz, m]  (km, km/s, kg)
    """

    area = math.pi * (AERO["diameter_m"] / 2) ** 2
    cd = AERO["drag_coeff"]
    mdot = stage_mdot(engine) if engine else 0.0
    has_engine = engine is not None
    isp_vac = engine["isp_vac_s"] if has_engine else 0.0
    d_isp = (engine["isp_vac_s"] - engine["isp_sl_s"]) if has_engine else 0.0
    need_alt = has_engine or drag
    kdrag = 0.5 * 1000.0 * cd * area
    ox, oy, oz = (float(c) for c in OMEGA_VEC)
    px, py, pz = (float(c) for c in EARTH_POLE)
    r_atm = R_EARTH + ATM_TOP_KM       # powyżej tego promienia wysokość >= ATM_TOP_KM, czyli brak atmosfery
    g0mdot = mdot * G0
    r_earth, f_earth, h_scale, h_top, rho0 = R_EARTH, F_EARTH, ATM_SCALE_H, ATM_TOP_KM, ATM_RHO0
    grav = gravity_xyz

    def rhs(t, y):
        x, yy, z, vx, vy, vz, m = y.tolist()
        t = float(t)
        ax, ay, az = grav(t, x, yy, z)
        dm = 0.0

        p = 0.0
        in_atm = False
        if need_alt:
            rn = _sqrt(x * x + yy * yy + z * z)
            if rn < r_atm:
                s = (x * px + yy * py + z * pz) / rn
                h = rn - r_earth * (1.0 - f_earth * s * s)
                if h < h_top:
                    p = _exp(-h / h_scale)
                    in_atm = True

        if has_engine:
            isp = isp_vac - d_isp * p
            k = g0mdot * isp / m / 1000.0                  # przyspieszenie od ciągu [km/s²]
            ux, uy, uz = steer(t, x, yy, z, vx, vy, vz)
            ax += k * ux
            ay += k * uy
            az += k * uz
            dm = -mdot

        if drag and in_atm:
            wx = vx - (oy * z - oz * yy)
            wy = vy - (oz * x - ox * z)
            wz = vz - (ox * yy - oy * x)
            k = kdrag * rho0 * p * _sqrt(wx * wx + wy * wy + wz * wz) / m
            ax -= k * wx
            ay -= k * wy
            az -= k * wz

        return np.array((vx, vy, vz, ax, ay, az, dm))

    return rhs


def unit(v):
    return v / np.linalg.norm(v)


def flight_path_angle_deg(r, v):
    return math.degrees(math.asin(np.dot(r, v) / (np.linalg.norm(r) * np.linalg.norm(v))))


def peri_apo(r, v, mu):
    """Promienie perycentrum i apocentrum orbity oskulacyjnej."""
    rn = np.linalg.norm(r)
    energy = np.dot(v, v) / 2 - mu / rn
    h = np.linalg.norm(np.cross(r, v))
    if energy >= 0:
        a = None
        e = math.sqrt(1 + 2 * energy * h * h / mu ** 2)
        return h * h / mu / (1 + e), math.inf
    a = -mu / (2 * energy)
    e = math.sqrt(max(0.0, 1 - h * h / (mu * a)))
    return a * (1 - e), a * (1 + e)


def fmt_time(seconds):
    s = int(round(seconds))
    return f"{s // 3600:03d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


# ============================================================
# MIEJSCE STARTU I OKNO STARTOWE
# ============================================================

def site_frame(times):
    """
    Dla chwil 'times' (astropy Time): położenie i prędkość miejsca startu
    (geocentryczne, osie ICRF) oraz wektory lokalne wschód/północ w ICRF.
    """

    lat = math.radians(LAUNCH_SITE["lat_deg"])
    lon = math.radians(LAUNCH_SITE["lon_deg"])
    loc = EarthLocation.from_geodetic(
        LAUNCH_SITE["lon_deg"] * u.deg, LAUNCH_SITE["lat_deg"] * u.deg,
        LAUNCH_SITE["alt_m"] * u.m,
    )

    east = np.array([-math.sin(lon), math.cos(lon), 0.0])
    north = np.array([-math.sin(lat) * math.cos(lon),
                      -math.sin(lat) * math.sin(lon), math.cos(lat)])

    x, y, z = loc.to_value(u.m)

    def gcrs(dx):
        shifted = EarthLocation.from_geocentric(
            x + 1000 * dx[0], y + 1000 * dx[1], z + 1000 * dx[2], unit=u.m
        )
        p, _ = shifted.get_gcrs_posvel(times)
        return p.xyz.to(u.km).value.T

    p, v = loc.get_gcrs_posvel(times)
    p = p.xyz.to(u.km).value.T
    v = v.xyz.to(u.km / u.s).value.T

    e_hat = gcrs(east) - p
    n_hat = gcrs(north) - p
    e_hat /= np.linalg.norm(e_hat, axis=-1, keepdims=True)
    n_hat /= np.linalg.norm(n_hat, axis=-1, keepdims=True)

    return p, v, e_hat, n_hat


def earth_rotation_vector(time):
    """
    Wektor prędkości kątowej Ziemi w osiach ICRF. Oś obrotu z danej daty różni się
    od osi Z układu ICRF (precesja: ~0,14° w 2025 r.). Bez tej poprawki rakieta
    na wyrzutni miałaby ~1 m/s "wiatru" i do ~50 m błędu wysokości, zależnie od
    pory dnia - dość, by zmieniać przebieg zwrotu grawitacyjnego i zużycie paliwa.
    """
    axis = EarthLocation.from_geocentric(0.0, 0.0, 1.0e6, unit=u.m)
    p, _ = axis.get_gcrs_posvel(time)
    return OMEGA_EARTH * unit(p.xyz.to(u.km).value)


def plane_normal(p, e_hat, n_hat, az_deg):
    az = math.radians(az_deg)
    d = math.sin(az) * e_hat + math.cos(az) * n_hat
    r_hat = p / np.linalg.norm(p, axis=-1, keepdims=True)
    n = np.cross(r_hat, d)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


def default_arrival_hours():
    """Przybliżony czas od startu do przylotu: wznoszenie + postój + lot."""
    return 0.2 + TLI["coast_min_h"] + 0.75 + TLI["time_of_flight_h"]


def moon_offplane(times, t_arrival_h, bias=0.0):
    """n(t) · kierunek Księżyca w chwili przylotu (+ poprawka z symulacji)."""
    p, _, e_hat, n_hat = site_frame(times)
    normals = plane_normal(p, e_hat, n_hat, LAUNCH_AZIMUTH_DEG)
    s_arr = EPH.sec(times.tdb.jd) + t_arrival_h * 3600.0
    moon = EPH.moon(s_arr)
    moon = moon / np.linalg.norm(moon, axis=-1, keepdims=True)
    return np.einsum("...j,...j->...", normals, moon) + bias, moon


# Najmniejszy zapas geometryczny okna startowego: nachylenie orbity minus
# |deklinacja Księżyca w chwili przylotu|. Przy zerowym zapasie płaszczyzna
# orbity tylko "muska" Księżyc i okno znika przy najmniejszej zmianie czasu lotu.
WINDOW_MARGIN_DEG = 3.0


_SCAN_CACHE = {}


def window_scan(t_arrival_h, around=None):
    """Siatka możliwych chwil startu i geometria niezależna od azymutu."""

    key = None
    if around is None:
        t0 = Time(EARLIEST_LAUNCH_UTC, scale="utc")
        n = int(LAUNCH_SEARCH_DAYS * 24 * 30) + 1          # co 2 minuty
        step = 2.0
        # transformacje astropy dla całej siatki są drogie, a nie zależą od czasu przylotu
        key = (str(EARLIEST_LAUNCH_UTC), n, LAUNCH_SITE["lat_deg"], LAUNCH_SITE["lon_deg"],
               LAUNCH_SITE.get("alt_m", 0.0))
    else:
        t0 = around - 90 * u.min
        n = 181                                             # +-1,5 h co 1 minutę
        step = 1.0

    cached = _SCAN_CACHE.get(key) if key is not None else None
    if cached is None:
        times = t0 + np.arange(n) * step * u.min
        p, _, e_hat, n_hat = site_frame(times)
        jd_tdb = times.tdb.jd
        if key is not None:
            _SCAN_CACHE.clear()
            _SCAN_CACHE[key] = (times, jd_tdb, p, e_hat, n_hat)
    else:
        times, jd_tdb, p, e_hat, n_hat = cached
    moon = EPH.moon(EPH.sec(jd_tdb) + t_arrival_h * 3600.0)
    moon = moon / np.linalg.norm(moon, axis=-1, keepdims=True)
    return {"times": times, "step": step, "n": n, "p": p, "east": e_hat, "north": n_hat, "moon": moon}


def window_roots(scan, az_deg, bias=0.0):
    """
    Wszystkie okazje startowe na siatce: chwile, w których płaszczyzna orbity
    parkingowej (dla azymutu az_deg) zawiera kierunek do Księżyca w chwili przylotu.
    """

    normals = plane_normal(scan["p"], scan["east"], scan["north"], az_deg)
    f = np.einsum("ij,ij->i", normals, scan["moon"]) + bias
    incl = np.degrees(np.arccos(np.clip(np.abs(normals[:, 2]), 0.0, 1.0)))
    dec = np.degrees(np.arcsin(np.clip(scan["moon"][:, 2], -1.0, 1.0)))

    roots = []
    for i in np.where(np.sign(f[:-1]) * np.sign(f[1:]) < 0)[0]:
        frac = f[i] / (f[i] - f[i + 1])
        roots.append({
            "index": int(i),
            "time": scan["times"][int(i)] + frac * scan["step"] * u.min,
            "margin_deg": float(incl[i] - abs(dec[i])),
            "incl_deg": float(incl[i]),
        })
    return roots


def choose_azimuth(t_arrival_h):
    """
    Dobiera azymut startu dla dowolnego miejsca na Ziemi: jak najbliżej kierunku
    wschodniego (90° = pełne wykorzystanie obrotu Ziemi, najmniej paliwa), ale
    tak, by w zadanym okresie istniało okno startowe z zapasem geometrycznym.
    Nachylenie orbity nie może być mniejsze niż |szerokość geograficzna| i musi
    przekraczać |deklinację Księżyca| w chwili przylotu - dlatego z miejsc blisko
    równika start bywa odchylony od wschodu.
    """

    scan = window_scan(t_arrival_h)
    for dev in np.arange(0.0, 85.1, 2.5):
        best = None
        for az in ((90.0,) if dev == 0 else (90.0 - dev, 90.0 + dev)):
            good = [r for r in window_roots(scan, az) if r["margin_deg"] >= WINDOW_MARGIN_DEG]
            if good and (best is None or good[0]["index"] < best[1]):
                best = (float(az), good[0]["index"], good[0]["incl_deg"])
        if best is not None:
            return best[0], best[2]

    dec = np.degrees(np.arcsin(scan["moon"][:, 2]))
    raise RuntimeError(
        "No launch window in the search period for any azimuth (Moon's declination "
        f"at arrival: {dec.min():.1f}..{dec.max():.1f}°). "
        "Increase LAUNCH_SEARCH_DAYS or change the date."
    )


def find_launch_window(t_arrival_h=None, bias=0.0, around=None):
    """
    Szuka chwili startu, w której płaszczyzna orbity parkingowej
    zawiera kierunek do Księżyca w chwili przylotu.
    around: jeśli podane, szuka najbliższego rozwiązania w pobliżu tej chwili.
    """

    if t_arrival_h is None:
        t_arrival_h = default_arrival_hours()

    scan = window_scan(t_arrival_h, around)
    roots = window_roots(scan, LAUNCH_AZIMUTH_DEG, bias)

    if not roots:
        dec = np.degrees(np.arcsin(scan["moon"][:, 2]))
        raise RuntimeError(
            "No launch window - the Moon is out of reach of the orbital planes "
            f"for azimuth {LAUNCH_AZIMUTH_DEG}° (Moon's declination: "
            f"{dec.min():.1f}..{dec.max():.1f}°). Change the azimuth (or set \"auto\") or the date."
        )

    if around is None:
        # pierwsza okazja z zapasem geometrycznym (a jeśli żadna go nie ma - pierwsza w ogóle)
        good = [r for r in roots if r["margin_deg"] >= WINDOW_MARGIN_DEG]
        pick = (good or roots)[0]
    else:
        pick = min(roots, key=lambda r: abs(r["index"] - scan["n"] // 2))
    return Time(pick["time"].utc.iso, scale="utc")


# ============================================================
# WZNOSZENIE NA ORBITĘ PARKINGOWĄ
# ============================================================

class Ascent:

    def __init__(self, t_launch):

        global OMEGA_VEC, EARTH_POLE
        OMEGA_VEC = earth_rotation_vector(t_launch)
        EARTH_POLE = OMEGA_VEC / OMEGA_EARTH

        self.t_launch = t_launch
        self.tL = EPH.sec(t_launch.tdb.jd)

        p, v, e_hat, n_hat = site_frame(t_launch)
        self.r0 = p
        self.v0 = v
        self.n_plane = plane_normal(p, e_hat, n_hat, LAUNCH_AZIMUTH_DEG)
        self._n = tuple(float(c) for c in self.n_plane)

        self.m0 = (sum(s["dry_kg"] + s["propellant_kg"] for s in STAGES)
                   + PAYLOAD["mass_kg"] + PAYLOAD["les_mass_kg"])
        self.r_target = R_EARTH + PARKING_ORBIT_ALT_KM

        # 1. człon lecimy bez zależności od parametrów -> liczymy raz.
        # Manewr pochylenia: z pliku albo ("auto") dobierany tak, by 1. człon kończył
        # pracę na zadanej wysokości - inaczej, zależnie od szerokości geograficznej
        # i azymutu, tor bywa za płaski (opór, straty) albo za stromy.
        kick = ASCENT["pitch_kick_deg"]
        if isinstance(kick, str):
            kick = self._tune_kick(ASCENT.get("stage1_cutoff_alt_km", 62.0))
        self.kick_deg = float(kick)
        self.stage1 = self._stage1(self.kick_deg)

    def _tune_kick(self, target_km):
        """Pochylenie [°], przy którym 1. człon kończy pracę na wysokości target_km."""
        def err(k):
            return altitude(self._stage1(k)["y_end"][0:3]) - target_km
        lo, hi = 0.1, 6.0
        if err(lo) < 0:
            return lo
        if err(hi) > 0:
            return hi
        for _ in range(14):
            mid = 0.5 * (lo + hi)
            if err(mid) > 0:
                lo = mid
            else:
                hi = mid
        return 0.5 * (lo + hi)

    def _down(self, r):
        return unit(np.cross(self.n_plane, unit(r)))

    def _down_xyz(self, x, y, z):
        """Wersja skalarna _down: kierunek 'w dół toru' = n x r / |n x r|."""
        nx, ny, nz = self._n
        rn = _sqrt(x * x + y * y + z * z)
        ux, uy, uz = x / rn, y / rn, z / rn
        cx = ny * uz - nz * uy
        cy = nz * ux - nx * uz
        cz = nx * uy - ny * ux
        cn = _sqrt(cx * cx + cy * cy + cz * cz)
        return cx / cn, cy / cn, cz / cn

    def _stage1(self, kick_deg):

        s1 = STAGES[0]
        tb = s1["propellant_kg"] / stage_mdot(s1)
        tv = ASCENT["vertical_rise_s"]
        tk = ASCENT["kick_duration_s"]
        kick = math.radians(kick_deg)
        tL = self.tL

        ox, oy, oz = (float(c) for c in OMEGA_VEC)

        def steer(t, x, y, z, vx, vy, vz):
            tau = t - tL
            rn = _sqrt(x * x + y * y + z * z)
            ux, uy, uz = x / rn, y / rn, z / rn
            if tau < tv:
                return ux, uy, uz
            dx, dy, dz = self._down_xyz(x, y, z)
            if tau < tv + tk:
                ang = kick * (tau - tv) / tk
            else:
                # zwrot grawitacyjny: ciąg wzdłuż prędkości względem atmosfery
                # (nie mniej pochylony niż po manewrze pochylenia)
                wx = vx - (oy * z - oz * y)
                wy = vy - (oz * x - ox * z)
                wz = vz - (ox * y - oy * x)
                vr = _sqrt(wx * wx + wy * wy + wz * wz)
                ang_v = (math.acos(min(1.0, max(-1.0, (wx * ux + wy * uy + wz * uz) / vr)))
                         if vr > 1e-6 else 0.0)
                ang = max(kick, ang_v)
            c, s = _cos(ang), _sin(ang)
            return c * ux + s * dx, c * uy + s * dy, c * uz + s * dz

        y0 = np.concatenate([self.r0, self.v0, [self.m0]])
        sol = solve_ivp(make_rhs(s1, steer, drag=True), (tL, tL + tb), y0,
                        method="DOP853", rtol=1e-10, atol=1e-8, dense_output=True)

        y = sol.y[:, -1].copy()
        if y[6] <= 0 or not np.all(np.isfinite(y)):
            raise RuntimeError("The first stage does not climb properly - check its thrust and mass.")
        return {"sol": sol, "t_end": tL + tb, "y_end": y}

    def simulate(self, params, record=False):
        """Zwraca (residua, informacje). params = (a, b) prawa linear tangent."""

        a_lt, b_lt = params
        segs, events = [], []
        e_target = -MU_EARTH / (2 * self.r_target)

        t = self.stage1["t_end"]
        y = self.stage1["y_end"].copy()
        s1 = STAGES[0]

        if record:
            segs.append((f"Ascent {s1['name']}", self.stage1["sol"], self.tL, t))
            events.append((f"{s1['name']} cutoff and separation", t, y.copy()))

        y[6] -= s1["dry_kg"]
        t_s2 = t
        t_les = t_s2 + PAYLOAD["les_jettison_after_s2_ign_s"]
        les_on = PAYLOAD["les_mass_kg"] > 0

        def steer(tt, x, y, z, vx, vy, vz):
            theta = math.atan(a_lt + b_lt * (tt - t_s2))
            c, s = _cos(theta), _sin(theta)
            dx, dy, dz = self._down_xyz(x, y, z)
            rn = _sqrt(x * x + y * y + z * z)
            return c * dx + s * x / rn, c * dy + s * y / rn, c * dz + s * z / rn

        def too_low(tt, yy):
            return altitude(yy[0:3]) - 40.0
        too_low.terminal = True
        too_low.direction = -1

        def cutoff(tt, yy):
            r = yy[0:3]
            v = yy[3:6]
            return np.dot(v, v) / 2 - MU_EARTH / np.linalg.norm(r) - e_target
        cutoff.terminal = True
        cutoff.direction = 1

        def failed(yy):
            r, v = yy[0:3], yy[3:6]
            energy = np.dot(v, v) / 2 - MU_EARTH / np.linalg.norm(r)
            return np.array([(np.linalg.norm(r) - self.r_target) / 10.0,
                             flight_path_angle_deg(r, v),
                             (e_target - energy) / 10.0 + 10.0]), {"reached": False}

        upper = STAGES[1:]
        for k, st in enumerate(upper):
            last = (k == len(upper) - 1)
            tb_full = st["propellant_kg"] / stage_mdot(st)
            t_ign = t
            t_stop = t + tb_full
            name = f"Ascent {st['name']}"

            # podział na części: przed i po odrzuceniu wieży LES
            cuts = [t_stop]
            if les_on and t < t_les < t_stop:
                cuts = [t_les, t_stop]

            reached = False
            for t_part in cuts:
                ev = (cutoff, too_low) if last else (too_low,)
                sol = solve_ivp(make_rhs(st, steer, drag=True), (t, t_part), y,
                                method="DOP853", rtol=1e-10, atol=1e-8,
                                events=ev, dense_output=record)
                if len(sol.t_events[-1]) > 0:          # za nisko
                    return failed(sol.y[:, -1])
                if record:
                    segs.append((name, sol, t, sol.t[-1]))
                t = sol.t[-1]
                y = sol.y[:, -1].copy()

                if last and len(sol.t_events[0]) > 0:  # osiągnięta orbita
                    reached = True
                    break
                if les_on and abs(t - t_les) < 1e-9:
                    if record:
                        events.append(("Launch escape system (LES) jettison", t, y.copy()))
                    y[6] -= PAYLOAD["les_mass_kg"]
                    les_on = False

            if not last:
                if record:
                    events.append((f"{st['name']} cutoff and separation", t, y.copy()))
                y[6] -= st["dry_kg"]

        if les_on:                                   # wieża nie została odrzucona wcześniej
            y[6] -= PAYLOAD["les_mass_kg"]

        st = STAGES[-1]
        t_end, y_end = t, y.copy()
        r, v = y_end[0:3], y_end[3:6]
        energy = np.dot(v, v) / 2 - MU_EARTH / np.linalg.norm(r)
        deficit = 0.0 if reached else (e_target - energy) / 10.0

        res = np.array([
            (np.linalg.norm(r) - self.r_target) / 10.0,
            flight_path_angle_deg(r, v),
            deficit,
        ])

        info = {
            "t_insertion": t_end,
            "y_insertion": y_end,
            "reached": reached,
            "s4b_prop_left": st["propellant_kg"] - stage_mdot(st) * (t_end - t_ign),
        }

        if record:
            events.append((f"Parking orbit insertion (end of {st['name']} first burn)",
                           t_end, y_end.copy()))
            info["segments"] = segs
            info["events"] = events

        return res, info

    def solve(self):

        y1 = self.stage1["y_end"]
        r1, v1 = y1[0:3], y1[3:6]
        v_rel = v1 - np.cross(OMEGA_VEC, r1)
        gamma = math.radians(flight_path_angle_deg(r1, v_rel))

        h1 = altitude(r1)
        print(f"{STAGES[0]['name']} cutoff (pitch kick {self.kick_deg:.2f}°): altitude {h1:.1f} km, "
              f"flight path angle {math.degrees(gamma):.1f}°, "
              f"speed {np.linalg.norm(v1):.2f} km/s")

        if h1 < 20:
            raise RuntimeError(f"{STAGES[0]['name']} burns out too low ({h1:.0f} km) - "
                               "reduce ASCENT['pitch_kick_deg'] or add first-stage thrust/propellant.")

        best = None
        for theta_end in (-5.0, -15.0, -25.0):
            x0 = [math.tan(gamma),
                  (math.tan(math.radians(theta_end)) - math.tan(gamma)) / 600.0]
            sol = least_squares(lambda p: self.simulate(p)[0], x0,
                                x_scale=[0.1, 1e-4], diff_step=1e-6, xtol=1e-12,
                                ftol=1e-12, max_nfev=200)
            if best is None or sol.cost < best.cost:
                best = sol
            if sol.cost < 1e-6:
                break

        res, info = self.simulate(best.x, record=True)

        if not info["reached"] or abs(res[0]) > 0.1 or abs(res[1]) > 0.05:
            raise RuntimeError(
                "Could not reach the parking orbit "
                f"(altitude error {res[0] * 10:.1f} km, flight path angle {res[1]:.2f}°). "
                "Not enough propellant/thrust, or change 'pitch_kick_deg'."
            )

        info["params"] = best.x
        return info


# ============================================================
# TLI I LOT DO KSIĘŻYCA
# ============================================================

def tof_to_radius(r_p, v_p, r_target):
    """
    Czas lotu (2 ciała) od perygeum do promienia r_target. Działa dla elipsy,
    paraboli i hiperboli - szybkie loty (poniżej ok. 50 h) są hiperboliczne.
    Zwraca None, jeśli orbita nie sięga promienia r_target.
    """
    alpha = 2.0 / r_p - v_p ** 2 / MU_EARTH          # 1/a
    p = (r_p * v_p) ** 2 / MU_EARTH
    e = p / r_p - 1.0
    if e <= 0:
        return None
    if alpha > 0 and (1 + e) / alpha < r_target:     # apogeum poniżej celu
        return None

    cos_nu = min(1.0, max(-1.0, (p / r_target - 1) / e))
    tan_half = math.tan(math.acos(cos_nu) / 2)

    if abs(alpha) * r_target < 1e-6:                 # parabola (równanie Barkera)
        return 0.5 * math.sqrt(p ** 3 / MU_EARTH) * (tan_half + tan_half ** 3 / 3)
    a = 1.0 / alpha
    if a > 0:                                        # elipsa
        E = 2 * math.atan(math.sqrt((1 - e) / (1 + e)) * tan_half)
        return (E - e * math.sin(E)) * math.sqrt(a ** 3 / MU_EARTH)
    F = 2 * math.atanh(min(math.sqrt((e - 1) / (e + 1)) * tan_half, 1 - 1e-15))   # hiperbola
    return (e * math.sinh(F) - F) * math.sqrt(-a ** 3 / MU_EARTH)


def vp_for_tof(r_p, r_target, tof):
    """Prędkość w perygeum, przy której lot do promienia r_target trwa 'tof' (2 ciała)."""
    v_lo = math.sqrt(MU_EARTH * (2 / r_p - 2 / (r_p + r_target))) * 1.000001   # elipsa Hohmanna
    v_hi = math.sqrt(2 * MU_EARTH / r_p) * 1.6                                  # daleko ponad prędkość ucieczki
    if tof_to_radius(r_p, v_lo, r_target) <= tof:
        return v_lo
    for _ in range(80):
        vm = 0.5 * (v_lo + v_hi)
        if tof_to_radius(r_p, vm, r_target) > tof:
            v_lo = vm
        else:
            v_hi = vm
    return 0.5 * (v_lo + v_hi)


def conic_time_to_radius(r, v, r_target, extrapolate=False):
    """
    Czas (2 ciała, wokół Ziemi) od stanu (r, v) do wznoszącego przejścia przez promień r_target.
    extrapolate=True: gdy apogeum leży poniżej r_target, zwraca czas do apogeum
    powiększony o (r_target/r_apo)^3 - ciągłe i rosnące przy malejącej energii,
    co wystarcza do szukania czasu pracy silnika metodą bisekcji.
    """
    rn = float(np.linalg.norm(r))
    vn2 = float(v @ v)
    h = float(np.linalg.norm(np.cross(r, v)))
    alpha = 2.0 / rn - vn2 / MU_EARTH
    p = h * h / MU_EARTH
    e_vec = ((vn2 - MU_EARTH / rn) * r - float(r @ v) * v) / MU_EARTH
    e = float(np.linalg.norm(e_vec))
    if e < 1e-6 or rn >= r_target:
        return None
    scale = 1.0
    if alpha > 0 and (1 + e) / alpha < r_target:
        if not extrapolate:
            return None
        r_apo = (1 + e) / alpha
        scale = (r_target / r_apo) ** 3
        r_target = r_apo * (1 - 1e-12)

    def anomaly_time(radius, outbound=True):
        cos_nu = min(1.0, max(-1.0, (p / radius - 1) / e))
        nu = math.acos(cos_nu)
        t2 = math.tan(nu / 2)
        if alpha > 0:
            a = 1 / alpha
            E = 2 * math.atan(math.sqrt((1 - e) / (1 + e)) * t2)
            t = (E - e * math.sin(E)) * math.sqrt(a ** 3 / MU_EARTH)
        else:
            a = -1 / alpha
            F = 2 * math.atanh(min(math.sqrt((e - 1) / (e + 1)) * t2, 1 - 1e-15))
            t = (e * math.sinh(F) - F) * math.sqrt(a ** 3 / MU_EARTH)
        return t if outbound else -t

    t_now = anomaly_time(rn, outbound=float(r @ v) >= 0)
    return (anomaly_time(r_target) - t_now) * scale


def moon_flyby_done(t, y):
    """Zdarzenie końcowe: statek, który minął Księżyc, oddala się na FLYBY_CUTOFF_KM (dalszy lot nieistotny)."""
    mx, my, mz = EPH.moon_pv(t)[:3]
    dx, dy, dz = y[0] - mx, y[1] - my, y[2] - mz
    return _sqrt(dx * dx + dy * dy + dz * dz) - FLYBY_CUTOFF_KM
moon_flyby_done.terminal = True
moon_flyby_done.direction = 1


class TransLunar:

    def __init__(self, asc_info):

        self.t_ins = asc_info["t_insertion"]
        self.y_ins = asc_info["y_insertion"]
        self.prop_left = asc_info["s4b_prop_left"]
        self.s4b = STAGES[-1]
        self.mdot = stage_mdot(self.s4b)
        self.tb_max = self.prop_left / self.mdot
        self.tof = TLI["time_of_flight_h"] * 3600.0
        self.r_target = R_MOON + LUNAR_ORBIT["perilune_alt_km"]

        # orbita parkingowa: jedno całkowanie z gęstym wyjściem
        t_end = self.t_ins + TLI["coast_max_h"] * 3600.0
        self.coast = solve_ivp(make_rhs(), (self.t_ins, t_end), self.y_ins,
                               method="DOP853", rtol=1e-11, atol=1e-9, dense_output=True)

    def _steer(self, psi):
        cp, sp = _cos(psi), _sin(psi)

        def steer(t, x, y, z, vx, vy, vz):
            nx = y * vz - z * vy
            ny = z * vx - x * vz
            nz = x * vy - y * vx
            nn = _sqrt(nx * nx + ny * ny + nz * nz)
            vn = _sqrt(vx * vx + vy * vy + vz * vz)
            a = cp / vn
            b = sp / nn
            return a * vx + b * nx, a * vy + b * ny, a * vz + b * nz
        return steer

    def simulate(self, params, rtol=1e-10, record=False):

        tc, tb, psi = params
        t0 = self.t_ins + tc
        y0 = self.coast.sol(t0)

        burn = solve_ivp(make_rhs(self.s4b, self._steer(psi)), (t0, t0 + tb), y0,
                         method="DOP853", rtol=rtol, atol=1e-9, dense_output=record)
        t1 = t0 + tb
        y1 = burn.y[:, -1].copy()
        y_burn_end = y1.copy()
        y1[6] = PAYLOAD["mass_kg"]              # odłączenie statku od S-IVB

        def peri(t, y):
            mx, my, mz, mvx, mvy, mvz = EPH.moon_pv(t)
            return ((y[0] - mx) * (y[3] - mvx) + (y[1] - my) * (y[4] - mvy)
                    + (y[2] - mz) * (y[5] - mvz))
        peri.direction = 1

        def crash(t, y):
            return _sqrt(y[0] * y[0] + y[1] * y[1] + y[2] * y[2]) - R_EARTH
        crash.terminal = True

        t_end = min(t1 + self.tof + 30 * 3600.0, EPH.t_max - 3600.0)
        coast = solve_ivp(make_rhs(), (t1, t_end), y1, method="DOP853",
                          rtol=rtol, atol=1e-9, events=(peri, crash, moon_flyby_done),
                          dense_output=record)

        best_d, best_t, best_y = math.inf, t_end, coast.y[:, -1]
        for tt, yy in zip(coast.t_events[0], coast.y_events[0]):
            d = np.linalg.norm(yy[0:3] - EPH.moon(tt))
            if d < best_d:
                best_d, best_t, best_y = d, tt, yy

        if not math.isfinite(best_d):
            best_d = np.linalg.norm(coast.y[0:3, -1] - EPH.moon(t_end))

        out = {
            "r_peri": best_d, "t_peri": best_t, "y_peri": best_y,
            "t_ign": t0, "t_cut": t1, "y_cut": y_burn_end,
        }
        if record:
            out["burn"] = burn
            out["coast"] = coast
        return out

    def residuals(self, params):
        o = self.simulate(params)
        return np.array([
            (o["r_peri"] - self.r_target) / 100.0,
            ((o["t_peri"] - o["t_cut"]) - self.tof) / 3600.0,
            math.degrees(params[2]) / 10.0 * 0.02,     # preferuj małe odchylenie
        ])

    # Dokładność całkowania przy poszukiwaniu przybliżonego rozwiązania (coarse): wystarcza do
    # wyboru czasu pracy i chwili zapłonu; dokładne celowanie (fine) liczy z rtol = 1e-10.
    SCAN_RTOL = 1e-7

    def _closest(self, tb, tc_center=None, half=1200.0, step=None, rtol=None):
        """
        Dla danego czasu pracy: moment zapłonu z najmniejszym chybieniem.
        Bez tc_center przeszukiwany jest cały zakres, z tc_center - okno +-half wokół niego.
        """

        c_min = TLI["coast_min_h"] * 3600.0
        c_max = TLI["coast_max_h"] * 3600.0
        rtol = rtol or self.SCAN_RTOL

        def miss(tc):
            return self.simulate((tc, tb, 0.0), rtol=rtol)["r_peri"]

        narrow = tc_center is not None and half < 1200.0
        if tc_center is None:
            grid = np.arange(c_min, c_max, 120.0)
        else:
            lo_w, hi_w = max(c_min, tc_center - half), min(c_max, tc_center + half)
            grid = np.arange(lo_w, hi_w, step or 120.0)
        if len(grid) < 3:
            grid = np.linspace(c_min, c_max, 3)

        vals = [miss(tc) for tc in grid]
        i = int(np.argmin(vals))
        if narrow and (i == 0 or i == len(grid) - 1) and (grid[i] - 1e-9 > c_min and grid[i] + 1e-9 < c_max):
            return self._closest(tb, tc_center, rtol=rtol)  # minimum poza wąskim oknem - szukaj szeroko
        lo = grid[max(i - 1, 0)]
        hi = grid[min(i + 1, len(grid) - 1)]
        res = minimize_scalar(miss, bounds=(lo, hi), method="bounded", options={"xatol": 0.5})
        o = self.simulate((res.x, tb, 0.0), rtol=rtol)
        tof = o["t_peri"] - o["t_cut"]
        if o["r_peri"] > 50_000.0:
            # daleko od Księżyca (np. orbita mocno nachylona do orbity Księżyca, a czas
            # pracy jeszcze nie ten): czas lotu do odległości Księżyca z orbity
            # keplerowskiej po zapłonie - nie zależy od tego, jak bardzo chybiamy
            y_c = o["y_cut"]
            tof = conic_time_to_radius(y_c[0:3], y_c[3:6], np.linalg.norm(EPH.moon(o["t_cut"] + self.tof)),
                                           extrapolate=True)
            if tof is None:
                tof = math.inf          # za mało energii, by dolecieć
        return res.x, o["r_peri"], tof, o

    def _tb_for_tof(self, tof_s, r_moon):
        """Czas pracy silnika dający (wg modelu 2 ciał i równania Ciołkowskiego) lot do r_moon w czasie tof_s."""
        r_p = float(np.linalg.norm(self.y_ins[0:3]))
        v_c = float(np.linalg.norm(self.y_ins[3:6]))
        dv = vp_for_tof(r_p, r_moon, tof_s) - v_c
        ve = self.s4b["isp_vac_s"] * G0 / 1000.0
        return self.y_ins[6] / self.mdot * (1 - math.exp(-dv / ve))

    def _coarse_fast(self, prev):
        """
        Szybka ścieżka coarse. Czas lotu jako funkcja czasu pracy jest skrajnie stromy
        (1 s pracy to ok. 10^4 s lotu), więc iterujemy nie po czasie pracy, lecz po
        "modelowym czasie lotu" tm: tb = tb_model(tm), a tm poprawiamy metodą siecznych
        o błąd czasu lotu z pełnej symulacji (zależność jest niemal liniowa, o nachyleniu ~1).
        Zwraca None, gdy się nie uda - wtedy działa wolniejsza metoda z przedziałem.
        """
        T = self.tof
        r_moon = float(np.linalg.norm(EPH.moon(self.t_ins + 2.5 * 3600 + T)))
        if prev is not None and "tmod" in prev:
            tm = prev["tmod"] - (prev["tof"] - T)
            tc_guess = prev["tc"]
        elif prev is not None:
            tm, tc_guess = T, prev["tc"]
        else:
            # Który z kolejnych "przelotów" przez okno zapłonu (co orbitę) wybrać, rozstrzyga skan
            # całego zakresu - dla tego samego czasu pracy co w metodzie z przedziałem, więc wynik
            # (moment zapłonu) jest ten sam.
            tm = T
            try:
                tb_scan = 0.93 * 1.01 * self._tb_for_tof(T, r_moon)
            except (ValueError, ZeroDivisionError, OverflowError):
                return None
            tc_guess = self._closest(tb_scan, None, rtol=1e-6)[0]

        hist, best = [], None
        for _ in range(9):
            tm = min(max(tm, 0.3 * T), 3.0 * T)
            try:
                tb = self._tb_for_tof(tm, r_moon)
            except (ValueError, ZeroDivisionError, OverflowError):
                return None
            if not (0.0 < tb <= self.tb_max):
                return None
            tc, r_min, tof, o = self._closest(tb, tc_guess, 600.0, 100.0)
            if not math.isfinite(tof) or r_min > 50_000.0:
                return None
            f = tof - T
            if best is None or abs(f) < best[0]:
                best = (abs(f), tb, tc, r_min, tof, o, tm)
            if abs(f) < 30.0:                               # dokładny czas lotu ustawia potem fine()
                break
            hist.append((tm, f))
            slope = 1.0
            if len(hist) >= 2 and abs(hist[-1][0] - hist[-2][0]) > 1e-6:
                slope = (hist[-1][1] - hist[-2][1]) / (hist[-1][0] - hist[-2][0])
                slope = min(3.0, max(0.3, slope))
            tm = tm - f / slope
            tc_guess = tc
        else:
            return None
        _, tb, tc, r_min, tof, o, tm = best
        return {"tc": tc, "tb": tb, "r_min": r_min, "tof": tof, "tmod": tm,
                "t_peri": o["t_peri"], "t_ign": self.t_ins + tc}

    def coarse(self, prev=None):
        """
        Dobiera moment zapłonu (tc) i czas pracy S-IVB (tb) tak, by lot
        trwał zadany czas i przechodził jak najbliżej środka Księżyca.
        """
        if prev is None:
            self._check_fuel_for_tli()
        c = self._coarse_fast(prev)
        if c is not None:
            return c
        return self._coarse_bracket(prev)

    def _check_fuel_for_tli(self):
        r_p = np.linalg.norm(self.y_ins[0:3])
        v_c = np.linalg.norm(self.y_ins[3:6])
        r_moon = np.linalg.norm(EPH.moon(self.t_ins + 2.5 * 3600 + self.tof))
        dv = vp_for_tof(r_p, r_moon, self.tof) - v_c
        ve = self.s4b["isp_vac_s"] * G0 / 1000.0
        tb0 = self.y_ins[6] / self.mdot * (1 - math.exp(-dv / ve)) * 1.01
        if tb0 > self.tb_max:
            raise RuntimeError(
                f"Not enough propellant in {STAGES[-1]['name']} for TLI: needs ~{tb0 * self.mdot:.0f} kg, "
                f"{self.prop_left:.0f} kg left. Reduce the payload or add propellant."
            )
        print(f"Estimated TLI Δv: {dv * 1000:.0f} m/s")

    def _coarse_bracket(self, prev=None):
        """
        Wolniejsza, ale pewna metoda: przedział czasu pracy + regula falsi (Illinois).
        Używana, gdy szybka ścieżka nie zbiegnie (oraz do zgłaszania przyczyn niepowodzenia).
        """

        if prev is None:
            # Pierwsze przybliżenie: Δv z zagadnienia 2 ciał dla zadanego czasu lotu
            r_p = np.linalg.norm(self.y_ins[0:3])
            v_c = np.linalg.norm(self.y_ins[3:6])
            r_moon = np.linalg.norm(EPH.moon(self.t_ins + 2.5 * 3600 + self.tof))
            dv = vp_for_tof(r_p, r_moon, self.tof) - v_c
            ve = self.s4b["isp_vac_s"] * G0 / 1000.0
            tb0 = self.y_ins[6] / self.mdot * (1 - math.exp(-dv / ve)) * 1.01

            if tb0 > self.tb_max:
                raise RuntimeError(
                    f"Not enough propellant in {STAGES[-1]['name']} for TLI: needs ~{tb0 * self.mdot:.0f} kg, "
                    f"{self.prop_left:.0f} kg left. Reduce the payload or add propellant."
                )
            tb_lo, tb_hi = 0.93 * tb0, min(1.07 * tb0, self.tb_max)
            tc_c = None
            n_iter = 14
        else:
            tb_lo, tb_hi = 0.98 * prev["tb"], min(1.02 * prev["tb"], self.tb_max)
            tc_c = prev["tc"]
            n_iter = 10

        tc_lo, _, tof_lo, _ = self._closest(tb_lo, tc_c)
        tc_hi, _, tof_hi, _ = self._closest(tb_hi, tc_lo)
        if not (tof_hi <= self.tof <= tof_lo):
            if prev is not None:
                return self._coarse_bracket(None)
            if math.isfinite(tof_hi):
                why = f"shortest possible: {tof_hi / 3600:.0f} h with the available propellant"
            else:
                why = "with this flight time the trajectory does not pass near the Moon"
            raise RuntimeError(f"The requested flight time of {self.tof / 3600:.1f} h is out of reach ({why}).")

        # f = (czas lotu - zadany): f_lo >= 0 >= f_hi; szukamy zera
        f_lo, f_hi = tof_lo - self.tof, tof_hi - self.tof
        tc, side, best = tc_lo, 0, None
        for _ in range(n_iter):
            if math.isfinite(f_lo) and math.isfinite(f_hi) and f_lo > f_hi:
                frac = min(0.98, max(0.02, f_lo / (f_lo - f_hi)))
                tb_mid = tb_lo + frac * (tb_hi - tb_lo)
                tc_guess = tc_lo + frac * (tc_hi - tc_lo)       # optymalny zapłon leży między skrajnymi
                half, step = 300.0, 100.0
            else:
                frac = 0.5
                tb_mid = 0.5 * (tb_lo + tb_hi)
                tc_guess = tc
                half, step = 1200.0, 120.0
            tc, r_min, tof_mid, o = self._closest(tb_mid, tc_guess, half, step)
            f_mid = tof_mid - self.tof
            if best is None or abs(f_mid) < best[0]:
                best = (abs(f_mid), tb_mid, tc, r_min, tof_mid, o)
            if abs(f_mid) < 2.0:                                  # czas lotu z dokładnością 2 s
                break
            if f_mid > 0:
                tb_lo, tc_lo, f_lo = tb_mid, tc, f_mid
                if side == 1:
                    f_hi *= 0.5
                side = 1
            else:
                tb_hi, tc_hi, f_hi = tb_mid, tc, f_mid
                if side == -1:
                    f_lo *= 0.5
                side = -1

        _, tb, tc, r_min, tof, o = best
        return {"tc": tc, "tb": tb, "r_min": r_min, "tof": tof,
                "t_peri": o["t_peri"], "t_ign": self.t_ins + tc}

    def _solve_tc(self, c, tb):
        """
        Sam moment zapłonu (bez odchylenia ciągu, psi = 0): pierwiastek równania
        r_peri(tc) = r_target, szukany po stronie późniejszego zapłonu od minimum chybienia.
        Zwraca None, gdy takiego pierwiastka nie ma (wtedy potrzebne jest odchylenie psi).
        """
        c_max = TLI["coast_max_h"] * 3600.0
        if not c["r_min"] < self.r_target:
            return None

        def f(tc):
            return self.simulate((tc, tb, 0.0))["r_peri"] - self.r_target

        lo = c["tc"]
        if f(lo) >= 0:
            return None
        for d in (4.0, 15.0, 60.0, 240.0, 900.0):
            hi = c["tc"] + d
            if hi > c_max:
                break
            if f(hi) > 0:
                return brentq(f, lo, hi, xtol=2e-3)
            lo = hi
        return None

    def fine(self, c):
        """Dokładne celowanie w wysokość peryselenium (moment zapłonu + odchylenie)."""

        c_min = TLI["coast_min_h"] * 3600.0
        c_max = TLI["coast_max_h"] * 3600.0
        tb = c["tb"]

        def res2(x):
            o = self.simulate((x[0], tb, x[1]))
            return [(o["r_peri"] - self.r_target) / 100.0, math.degrees(x[1]) / 10.0 * 0.02]

        tc_root = self._solve_tc(c, tb)
        if tc_root is not None:
            x = np.array([tc_root, tb, 0.0])
            res0 = 0.0
        else:
            best = None
            for i, (dtc, psi0) in enumerate(((3.0, 0.0), (-3.0, 0.0), (10.0, 0.002),
                                             (-10.0, -0.002), (3.0, 0.01), (-3.0, -0.01))):
                sol = least_squares(res2, [c["tc"] + dtc, psi0],
                                    bounds=([c_min, -0.3], [c_max, 0.3]),
                                    x_scale=[1.0, 0.002], diff_step=1e-7,
                                    xtol=1e-9, ftol=1e-9, gtol=1e-6, max_nfev=60)
                prev = None if best is None else abs(best.fun[0])
                if best is None or abs(sol.fun[0]) < abs(best.fun[0]):
                    best = sol
                if abs(sol.fun[0]) < 1e-3:
                    break
                # dwa starty utknęły w tym samym minimum - dalsze nic nie dadzą,
                # reszta pracy przypada na wariant z czasem pracy silnika (res3)
                if i >= 1 and abs(best.fun[0]) > 1.0 and prev is not None \
                        and abs(abs(sol.fun[0]) - prev) < 0.02 * prev:
                    break
            x = np.array([best.x[0], tb, best.x[1]])
            res0 = best.fun[0]

        if abs(res0) > 0.1:
            # Sam moment zapłonu i odchylenie nie wystarczają (zdarza się przy orbitach
            # mocno nachylonych do orbity Księżyca): zmieniamy też czas pracy silnika,
            # pozwalając czasowi lotu odejść nieco od zadanego.
            def res3(z):
                o = self.simulate(z)
                return [(o["r_peri"] - self.r_target) / 100.0,
                        ((o["t_peri"] - o["t_cut"]) - self.tof) / 3600.0 * 0.05,
                        math.degrees(z[2]) / 10.0 * 0.02]
            sol3 = least_squares(res3, [c["tc"], tb, 0.0],
                                 bounds=([c_min, 0.95 * tb, -0.3], [c_max, min(1.05 * tb, self.tb_max), 0.3]),
                                 x_scale=[1.0, 0.05, 0.002], diff_step=1e-7,
                                 xtol=1e-9, ftol=1e-9, gtol=1e-6, max_nfev=120)
            if abs(sol3.fun[0]) < abs(res0):
                x = np.array(sol3.x)
                tb = x[1]

        # Dopracowanie: wszystkie 3 zmienne, cel = wysokość peryselenium + czas lotu
        sol = least_squares(self.residuals, x,
                            bounds=([c_min, 0.9 * tb, -0.3], [c_max, min(1.1 * tb, self.tb_max), 0.3]),
                            x_scale=[1.0, 0.05, 0.002], diff_step=1e-8,
                            xtol=1e-9, ftol=1e-9, gtol=1e-6, max_nfev=100)
        o_try = self.simulate(sol.x)
        if abs(o_try["r_peri"] - self.r_target) < 1.0:
            x = sol.x

        o = self.simulate(x, record=True)
        err_r = o["r_peri"] - self.r_target
        err_t = (o["t_peri"] - o["t_cut"]) - self.tof
        print(f"Result: perilune altitude error {err_r:.2f} km, "
              f"flight time error {err_t / 60:.1f} min")

        if abs(err_r) > 10:
            raise RuntimeError("Could not target the Moon - change the flight time or the date.")

        o["params"] = x
        o["prop_left"] = self.prop_left - self.mdot * x[1]
        o["m_ign"] = self.coast.sol(o["t_ign"])[6]
        return o


# ============================================================
# WEJŚCIE NA ORBITĘ KSIĘŻYCA (LOI)
# ============================================================

def lunar_orbit_insertion(tli, orbit_hours=6.0, prop_avail=None):

    eng = {
        "thrust_vac_N": SPACECRAFT_ENGINE["thrust_N"],
        "isp_vac_s": SPACECRAFT_ENGINE["isp_s"],
        "isp_sl_s": SPACECRAFT_ENGINE["isp_s"],
    }
    mdot = stage_mdot(eng)
    ve = SPACECRAFT_ENGINE["isp_s"] * G0 / 1000.0

    t_p = tli["t_peri"]
    y_p = tli["y_peri"]
    r_rel = y_p[0:3] - EPH.moon(t_p)
    v_rel = y_p[3:6] - EPH.moon_v(t_p)
    rp = np.linalg.norm(r_rel)
    vp = np.linalg.norm(v_rel)

    ra_t = R_MOON + LUNAR_ORBIT["apolune_alt_km"]
    a_t = 0.5 * (R_MOON + LUNAR_ORBIT["perilune_alt_km"] + ra_t)
    v_t = math.sqrt(MU_MOON * (2 / rp - 1 / a_t))
    dv = vp - v_t
    m = y_p[6]
    tb = m / mdot * (1 - math.exp(-dv / ve))

    e_target = -MU_MOON / (2 * a_t)
    if prop_avail is None:
        prop_avail = SPACECRAFT_ENGINE["propellant_kg"]
    tb_max = prop_avail / mdot
    rp_t = R_MOON + LUNAR_ORBIT["perilune_alt_km"]

    def done(t, y):
        rr = y[0:3] - EPH.moon(t)
        vv = y[3:6] - EPH.moon_v(t)
        return np.dot(vv, vv) / 2 - MU_MOON / np.linalg.norm(rr) - e_target
    done.terminal = True
    done.direction = -1

    def burn_sim(k, alpha, dense=False):
        """k: jaka część szacowanego czasu pracy przypada przed peryselenium,
        alpha: pochylenie ciągu od kierunku wstecznego ku górze (radialnie)."""
        t_ign = t_p - k * tb
        y0 = tli["coast"].sol(t_ign)

        ca, sa = _cos(alpha), _sin(alpha)

        def steer(t, x, y, z, vx, vy, vz):
            mx, my, mz, mvx, mvy, mvz = EPH.moon_pv(t)
            rx, ry, rz = x - mx, y - my, z - mz
            wx, wy, wz = vx - mvx, vy - mvy, vz - mvz
            a = -ca / _sqrt(wx * wx + wy * wy + wz * wz)
            b = sa / _sqrt(rx * rx + ry * ry + rz * rz)
            return a * wx + b * rx, a * wy + b * ry, a * wz + b * rz

        burn = solve_ivp(make_rhs(eng, steer), (t_ign, t_ign + tb_max), y0,
                         method="DOP853", rtol=1e-11, atol=1e-9, events=done,
                         dense_output=dense)
        y_cut = burn.y[:, -1]
        rr = y_cut[0:3] - EPH.moon(burn.t[-1])
        vv = y_cut[3:6] - EPH.moon_v(burn.t[-1])
        peri, apo = peri_apo(rr, vv, MU_MOON)
        return burn, t_ign, y0, peri, apo

    # Dobór chwili zapłonu i pochylenia ciągu tak, by trafić w zadaną orbitę
    def res(x):
        _, _, _, peri, apo = burn_sim(x[0], x[1])
        apo = min(apo, 1e5)
        return [(peri - rp_t) / 10.0, (apo - ra_t) / 10.0]

    sol = least_squares(res, [0.5, 0.0], bounds=([0.0, -0.5], [1.0, 0.5]),
                        x_scale=[0.05, 0.02], diff_step=1e-6, max_nfev=80)

    burn, t_ign, y0, _, _ = burn_sim(sol.x[0], sol.x[1], dense=True)
    t_cut = burn.t[-1]
    y_cut = burn.y[:, -1].copy()

    t_end = min(t_cut + orbit_hours * 3600.0, EPH.t_max - 60.0)
    orbit = solve_ivp(make_rhs(), (t_cut, t_end), y_cut, method="DOP853",
                      rtol=1e-11, atol=1e-9, dense_output=True)

    rr = y_cut[0:3] - EPH.moon(t_cut)
    vv = y_cut[3:6] - EPH.moon_v(t_cut)
    peri, apo = peri_apo(rr, vv, MU_MOON)

    return {
        "t_ign": t_ign, "t_cut": t_cut, "y_ign": y0, "y_cut": y_cut,
        "burn": burn, "orbit": orbit, "t_end": t_end,
        "dv": ve * 1000 * math.log(y0[6] / y_cut[6]),
        "reached": len(burn.t_events[0]) > 0,
        "peri_alt": peri - R_MOON, "apo_alt": apo - R_MOON,
        "prop_left": prop_avail - mdot * (t_cut - t_ign),
        "prop_used": mdot * (t_cut - t_ign),
    }


# ============================================================
# ORIENTACJA KSIĘŻYCA I PUNKT LĄDOWANIA
# ============================================================
# Model obrotu Księżyca IAU/WGCCRE (Archinal i in. 2011): biegun, południk
# zerowy i libracje. Współrzędne selenograficzne ~ układ "Mean Earth".

MOON_ROT_RATE = math.radians(13.17635815) / 86400.0      # rad/s


def _moon_angles(jd_tdb):
    """Kąty modelu IAU (rektascensja i deklinacja bieguna, południk zerowy) w stopniach; skalar lub tablica."""

    d = jd_tdb - 2451545.0
    T = d / 36525.0
    E = np.radians([
        125.045 - 0.0529921 * d, 250.089 - 0.1059842 * d, 260.008 + 13.0120009 * d,
        176.625 + 13.3407154 * d, 357.529 + 0.9856003 * d, 311.589 + 26.4057084 * d,
        134.963 + 13.0649930 * d, 276.617 + 0.3287146 * d, 34.226 + 1.7484877 * d,
        15.134 - 0.1589763 * d, 119.743 + 0.0036096 * d, 239.961 + 0.1643573 * d,
        25.053 + 12.9590088 * d,
    ])
    sE, cE = np.sin(E), np.cos(E)

    ra = (269.9949 + 0.0031 * T - 3.8787 * sE[0] - 0.1204 * sE[1] + 0.0700 * sE[2]
          - 0.0172 * sE[3] + 0.0072 * sE[5] - 0.0052 * sE[9] + 0.0043 * sE[12])
    dec = (66.5392 + 0.0130 * T + 1.5419 * cE[0] + 0.0239 * cE[1] - 0.0278 * cE[2]
           + 0.0068 * cE[3] - 0.0029 * cE[5] + 0.0009 * cE[6] + 0.0008 * cE[9]
           - 0.0009 * cE[12])
    W = (38.3213 + 13.17635815 * d - 1.4e-12 * d * d + 3.5610 * sE[0] + 0.1208 * sE[1]
         - 0.0642 * sE[2] + 0.0158 * sE[3] + 0.0252 * sE[4] - 0.0066 * sE[5]
         - 0.0047 * sE[6] - 0.0046 * sE[7] + 0.0028 * sE[8] + 0.0052 * sE[9]
         + 0.0040 * sE[10] + 0.0019 * sE[11] - 0.0044 * sE[12])
    return ra, dec, W


def moon_orientation(jd_tdb):
    """Macierz obrotu: układ związany z Księżycem -> ICRF, oraz wektor bieguna."""

    ra, dec, W = _moon_angles(jd_tdb)

    def rz(a):
        c, s_ = math.cos(a), math.sin(a)
        return np.array([[c, -s_, 0.0], [s_, c, 0.0], [0.0, 0.0, 1.0]])

    def rx(a):
        c, s_ = math.cos(a), math.sin(a)
        return np.array([[1.0, 0.0, 0.0], [0.0, c, -s_], [0.0, s_, c]])

    M = rz(math.radians(ra + 90.0)) @ rx(math.radians(90.0 - dec)) @ rz(math.radians(W))
    return M, M[:, 2]


def moon_orientation_many(jd_tdb):
    """To samo dla tablicy chwil: macierze (N, 3, 3) obliczone jednym przebiegiem numpy."""

    ra, dec, W = _moon_angles(np.atleast_1d(np.asarray(jd_tdb, dtype=float)))

    def rz(a):
        c, s_ = np.cos(a), np.sin(a)
        R = np.zeros(a.shape + (3, 3))
        R[..., 0, 0], R[..., 0, 1], R[..., 1, 0], R[..., 1, 1], R[..., 2, 2] = c, -s_, s_, c, 1.0
        return R

    def rx(a):
        c, s_ = np.cos(a), np.sin(a)
        R = np.zeros(a.shape + (3, 3))
        R[..., 0, 0], R[..., 1, 1], R[..., 1, 2], R[..., 2, 1], R[..., 2, 2] = 1.0, c, -s_, s_, c
        return R

    return rz(np.radians(ra + 90.0)) @ rx(np.radians(90.0 - dec)) @ rz(np.radians(W))


def site_body_vector():
    lat = math.radians(LANDING_SITE["lat_deg"])
    lon = math.radians(LANDING_SITE["lon_deg"])
    R = R_MOON + LANDING_SITE.get("elevation_m", 0.0) / 1000.0
    return R * np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])


def site_rel_many(t):
    """Położenia lądowiska względem środka Księżyca (osie ICRF) dla tablicy chwil t [s] - (N, 3)."""
    return moon_orientation_many(EPH.jd(t)) @ site_body_vector()


def site_state(t):
    """Położenie i prędkość lądowiska względem środka Księżyca (osie ICRF)."""
    M, pole = moon_orientation(float(EPH.jd(t)))
    rho = M @ site_body_vector()
    return rho, np.cross(pole * MOON_ROT_RATE, rho)


def selenographic(t, rho):
    """Współrzędne selenograficzne (lat, lon w stopniach) wektora rho."""
    M, _ = moon_orientation(float(EPH.jd(t)))
    b = M.T @ rho
    return (math.degrees(math.atan2(b[2], math.hypot(b[0], b[1]))),
            math.degrees(math.atan2(b[1], b[0])))


def moon_rel(t, y):
    return y[0:3] - EPH.moon(t), y[3:6] - EPH.moon_v(t)


# ============================================================
# KOREKTA KURSU (MCC) - ustawienie orbity nad lądowiskiem
# ============================================================

def propagate_to_perilune(t0, y0, t_end, rtol=1e-10, dense=False):

    def peri(t, y):
        mx, my, mz, mvx, mvy, mvz = EPH.moon_pv(t)
        return ((y[0] - mx) * (y[3] - mvx) + (y[1] - my) * (y[4] - mvy)
                + (y[2] - mz) * (y[5] - mvz))
    peri.direction = 1

    sol = solve_ivp(make_rhs(), (t0, t_end), y0, method="DOP853", rtol=rtol,
                    atol=1e-9, events=(peri, moon_flyby_done), dense_output=dense)

    best = (math.inf, t_end, sol.y[:, -1])
    for tt, yy in zip(sol.t_events[0], sol.y_events[0]):
        d = np.linalg.norm(yy[0:3] - EPH.moon(tt))
        if d < best[0]:
            best = (d, tt, yy)
    return {"r_peri": best[0], "t_peri": best[1], "y_peri": best[2], "coast": sol}


class _Solution:
    """Minimalny odpowiednik wyniku least_squares: tylko x i fun."""

    def __init__(self, x, fun):
        self.x, self.fun = x, fun


def _chord_least_squares(res, x0, h=2e-6, tol=2e-10, max_iter=14):
    """
    Najmniejsze kwadraty dla niemal liniowego zadania: jakobian z różnic skończonych liczony
    raz (i odświeżany tylko przy wolnej zbieżności), potem kroki Gaussa-Newtona.
    Zwraca None, gdy nie osiągnie zbieżności (wtedy trzeba użyć ogólnego solvera).
    """
    x = np.array(x0, dtype=float)
    F = np.asarray(res(x), dtype=float)

    def jacobian(x, F):
        J = np.empty((len(F), len(x)))
        for i in range(len(x)):
            xi = x.copy()
            xi[i] += h
            J[:, i] = (np.asarray(res(xi), dtype=float) - F) / h
        return J

    J = jacobian(x, F)
    prev = None
    for _ in range(max_iter):
        step = np.linalg.lstsq(J, -F, rcond=None)[0]
        x = x + step
        F = np.asarray(res(x), dtype=float)
        size = float(np.linalg.norm(step))
        if size < tol:
            return _Solution(x, F)
        if prev is not None and size > 0.3 * prev:
            J = jacobian(x, F)                      # zbieżność zbyt wolna - odśwież jakobian
        prev = size
    return None


def mcc_targeting(tli, t_land_est, dv0=None):
    """
    Impulsowa korekta kursu (silnik CSM) tak, by:
      - peryselenium było na zadanej wysokości,
      - płaszczyzna orbity wokół Księżyca przechodziła nad lądowiskiem
        w przewidywanej chwili lądowania.
    Spośród rozwiązań wybierana jest korekta o najmniejszym Δv.
    """

    t_m = min(tli["t_cut"] + MCC["after_tli_h"] * 3600.0, tli["t_peri"] - 6 * 3600.0)
    y_m = tli["coast"].sol(t_m)
    ve = CSM["isp_s"] * G0 / 1000.0
    r_target = R_MOON + LUNAR_ORBIT["perilune_alt_km"]
    t_end = min(tli["t_peri"] + 12 * 3600.0, EPH.t_max - 3600.0)
    s_hat = unit(site_state(t_land_est)[0])

    def sim(dv, dense=False, rtol=1e-10):
        y = y_m.copy()
        y[3:6] += dv
        y[6] *= math.exp(-np.linalg.norm(dv) / ve)
        return propagate_to_perilune(t_m, y, t_end, rtol=rtol, dense=dense), y

    def res(dv):
        o, _ = sim(dv)
        rho, vv = moon_rel(o["t_peri"], o["y_peri"])
        h = unit(np.cross(rho, vv))
        return np.concatenate([[o["r_peri"] - r_target, (h @ s_hat) * R_MOON],
                               dv * 1000.0 * 0.01])

    # Zadanie ma więcej niewiadomych (3 składowe dv) niż warunków (2), a dodatkowy człon
    # kary wybiera spośród rozwiązań to o najmniejszym dv. Warunki są niemal liniowe względem dv,
    # więc wystarczy raz policzyć jakobian i iterować (metoda cięciwy); wolniejsze, ogólne
    # najmniejsze kwadraty zostają jako zabezpieczenie.
    best = _chord_least_squares(res, np.zeros(3) if dv0 is None else np.asarray(dv0, dtype=float))
    if best is None:
        starts = [np.zeros(3)] if dv0 is None else [dv0, np.zeros(3)]
        for x0 in starts:
            sol = least_squares(res, x0, x_scale=1e-4, diff_step=1e-7,
                                xtol=1e-14, ftol=1e-14, max_nfev=200)
            if best is None or np.abs(sol.fun[:2]).max() < np.abs(best.fun[:2]).max():
                best = sol

    o, y_after = sim(best.x, dense=True)
    rho, vv = moon_rel(o["t_peri"], o["y_peri"])
    o.update({
        "t_mcc": t_m, "y_mcc_before": y_m, "y_mcc_after": y_after,
        "dv_vec": best.x, "dv": np.linalg.norm(best.x) * 1000.0,
        "prop_used": y_m[6] - y_after[6],
        "err_r": o["r_peri"] - r_target,
        "err_plane_km": (unit(np.cross(rho, vv)) @ s_hat) * R_MOON,
    })
    return o


# ============================================================
# ORBITA KSIĘŻYCA: PRZELOT NAD LĄDOWISKIEM
# ============================================================

def find_overflight(sol, t_from, t_to, step=10.0):
    """Pierwszy przelot nad lądowiskiem w przedziale czasu (najmniejsza odległość kątowa)."""

    ts = np.arange(t_from, t_to, step)
    Y = sol.sol(ts)
    rho = Y[0:3].T - EPH.moon(ts)
    S = site_rel_many(ts)
    ang = np.arccos(np.clip(np.einsum("ij,ij->i", unit_rows(rho), unit_rows(S)), -1, 1))

    idx = [i for i in range(1, len(ts) - 1)
           if ang[i] <= ang[i - 1] and ang[i] <= ang[i + 1] and ang[i] < math.radians(10)]
    if not idx:
        return None
    i = idx[0]

    def f(t):
        y = sol.sol(t)
        return math.acos(np.clip(unit(y[0:3] - EPH.moon(t)) @ unit(site_state(t)[0]), -1, 1))

    r = minimize_scalar(f, bounds=(ts[i - 1], ts[i + 1]), method="bounded", options={"xatol": 0.01})
    y = sol.sol(r.x)
    rho_, vv = moon_rel(r.x, y)
    h = unit(np.cross(rho_, vv))
    s = site_state(r.x)[0]
    return {"t": r.x, "dist_km": r.fun * R_MOON,
            "cross_km": math.asin(np.clip(h @ unit(s), -1, 1)) * R_MOON}


def unit_rows(a):
    return a / np.linalg.norm(a, axis=1, keepdims=True)


# ============================================================
# LĄDOWNIK: DOI I LĄDOWANIE Z NAPROWADZANIEM
# ============================================================

def lander_engine(throttle=1.0):
    return {"thrust_vac_N": LANDER["thrust_N"] * throttle,
            "isp_vac_s": LANDER["isp_s"], "isp_sl_s": LANDER["isp_s"]}


def descent_orbit_insertion(orbit_sol, t_doi):
    """Oddzielenie lądownika i obniżenie peryselenium (silnik lądownika, 10% ciągu)."""

    y0 = orbit_sol.sol(t_doi).copy()
    y0[6] = LANDER["mass_kg"]
    r_target = R_MOON + LANDING["doi_perilune_alt_km"]

    def steer(t, x, y, z, vx, vy, vz):
        mx, my, mz, mvx, mvy, mvz = EPH.moon_pv(t)
        wx, wy, wz = vx - mvx, vy - mvy, vz - mvz
        a = -1.0 / _sqrt(wx * wx + wy * wy + wz * wz)
        return a * wx, a * wy, a * wz

    def done(t, y):
        rho, vv = moon_rel(t, y)
        return peri_apo(rho, vv, MU_MOON)[0] - r_target
    done.terminal = True
    done.direction = -1

    eng = lander_engine(LANDER["min_throttle"])
    burn = solve_ivp(make_rhs(eng, steer), (t_doi, t_doi + 900.0), y0, method="DOP853",
                     rtol=1e-11, atol=1e-9, events=done, dense_output=True)
    if len(burn.t_events[0]) == 0:
        raise RuntimeError("DOI: the lander could not lower its orbit (not enough propellant/thrust).")

    t_cut = burn.t[-1]
    y_cut = burn.y[:, -1].copy()
    rho, vv = moon_rel(t_cut, y_cut)
    period = 2 * math.pi * math.sqrt(peri_apo_a(rho, vv, MU_MOON) ** 3 / MU_MOON)
    coast = solve_ivp(make_rhs(), (t_cut, t_cut + 1.2 * period), y_cut, method="DOP853",
                      rtol=1e-11, atol=1e-9, dense_output=True)
    peri, apo = peri_apo(rho, vv, MU_MOON)
    ve = LANDER["isp_s"] * G0
    return {"t_ign": t_doi, "t_cut": t_cut, "y_ign": y0, "y_cut": y_cut,
            "burn": burn, "coast": coast, "period": period,
            "dv": ve * math.log(y0[6] / y_cut[6]), "prop_used": y0[6] - y_cut[6],
            "peri_alt": peri - R_MOON, "apo_alt": apo - R_MOON}


def peri_apo_a(r, v, mu):
    energy = np.dot(v, v) / 2 - mu / np.linalg.norm(r)
    return -mu / (2 * energy)


def make_descent_rhs(pT, vT, t_f, m_min):
    """Naprowadzanie ZEM/ZEV (optymalne energetycznie, cel: położenie + prędkość w chwili t_f)."""

    f_max = LANDER["thrust_N"]
    f_min = LANDER["min_throttle"] * f_max
    k_mdot = 1.0 / (LANDER["isp_s"] * G0)
    ptx, pty, ptz = (float(c) for c in pT)
    vtx, vty, vtz = (float(c) for c in vT)
    mu_moon = MU_MOON

    def rhs(t, y):
        x, yy, z, vx, vy, vz, m = y.tolist()
        t = float(t)
        mx, my, mz, mvx, mvy, mvz, sx, sy, sz = EPH.bodies(t)
        rx, ry, rz = x - mx, yy - my, z - mz            # położenie względem Księżyca
        wx, wy, wz = vx - mvx, vy - mvy, vz - mvz       # prędkość względem Księżyca
        tgo = t_f - t
        if tgo < 1.0:
            tgo = 1.0
        rn = _sqrt(rx * rx + ry * ry + rz * rz)
        c = -mu_moon / (rn * rn * rn)
        gx, gy, gz = c * rx, c * ry, c * rz
        h2 = 0.5 * tgo * tgo
        k1 = 6.0 / (tgo * tgo)
        k2 = 2.0 / tgo
        cx = k1 * (ptx - (rx + wx * tgo + gx * h2)) - k2 * (vtx - (wx + gx * tgo))
        cy = k1 * (pty - (ry + wy * tgo + gy * h2)) - k2 * (vty - (wy + gy * tgo))
        cz = k1 * (ptz - (rz + wz * tgo + gz * h2)) - k2 * (vtz - (wz + gz * tgo))
        an = _sqrt(cx * cx + cy * cy + cz * cz)
        F = an * m * 1000.0
        if m > m_min:
            F = f_min if F < f_min else (f_max if F > f_max else F)
        else:
            F = 0.0
        ax, ay, az = accel_xyz(x, yy, z, mx, my, mz, sx, sy, sz)
        if an > 0 and F > 0:
            k = F / m / 1000.0 / an
            ax += k * cx
            ay += k * cy
            az += k * cz
        return np.array((vx, vy, vz, ax, ay, az, -F * k_mdot))

    return rhs


def descent_sim(desc_sol, t_pdi, T_brake, m_min, record=False, fast=False):
    """Lądowanie z naprowadzaniem: hamowanie -> high gate -> low gate -> przyziemienie."""

    L = LANDING
    y = desc_sol.sol(t_pdi).copy()
    t_hg = t_pdi + T_brake
    t_lg = t_hg + L["approach_time_s"]
    t_td = t_lg + L["vertical_time_s"]

    rho0, v0 = moon_rel(t_pdi, y)
    h = unit(np.cross(rho0, v0))

    def gate(t, alt_m, range_m, v_h, v_down):
        s, vs = site_state(t)
        up = unit(s)
        d = unit(np.cross(h, up))         # kierunek lotu nad lądowiskiem
        p = s + up * alt_m / 1000.0 - d * range_m / 1000.0
        v = vs + d * v_h / 1000.0 - up * v_down / 1000.0
        return p, v

    phases = [
        ("Landing: braking", t_hg, gate(t_hg, L["high_gate_alt_m"], L["high_gate_range_m"],
                                            L["high_gate_speed_m_s"], L["high_gate_sink_m_s"])),
        ("Landing: approach", t_lg, gate(t_lg, L["low_gate_alt_m"], 0.0, 0.0,
                                            L["low_gate_alt_m"] / L["vertical_time_s"])),
        # cel 2 m pod powierzchnią -> styk z gruntem tuż przed t_td z zadaną prędkością
        ("Landing: vertical descent", t_td, gate(t_td, -2.0, 0.0, 0.0, L["touchdown_speed_m_s"])),
    ]

    r_site = float(np.linalg.norm(site_body_vector()))

    def touchdown(t, yy):
        mx, my, mz = EPH.moon_pv(t)[:3]
        dx, dy, dz = yy[0] - mx, yy[1] - my, yy[2] - mz
        return _sqrt(dx * dx + dy * dy + dz * dz) - r_site
    touchdown.terminal = True
    touchdown.direction = -1

    # tryb szybki (tylko do przeszukiwania kandydatów): luźniejsza tolerancja i dłuższy krok
    rtol, max_step = (1e-6, 2.0) if fast else (1e-8, 0.5)

    segs, events = [], []
    t = t_pdi
    landed = False
    for k, (name, t_f, (pT, vT)) in enumerate(phases):
        t_stop = t_f + (60.0 if k == len(phases) - 1 else 0.0)
        sol = solve_ivp(make_descent_rhs(pT, vT, t_f, m_min), (t, t_stop), y,
                        method="RK45", rtol=rtol, atol=1e-9, max_step=max_step,
                        events=touchdown, dense_output=record)
        if record:
            segs.append((name, sol, t, sol.t[-1]))
        t = sol.t[-1]
        y = sol.y[:, -1].copy()
        if record and k < len(phases) - 1 and sol.status == 0:
            events.append((name.replace("Landing: ", "End of phase: "), t, y.copy()))
        if len(sol.t_events[0]) > 0:
            landed = True
            early = k < len(phases) - 1
            break

    s, vs = site_state(t)
    rho, vv = moon_rel(t, y)
    v_surf = (vv - vs) * 1000.0
    up = unit(s)
    out = {
        "landed": landed and not early if landed else False,
        "crashed_early": landed and early,
        "t_td": t, "y_td": y,
        "miss_m": np.linalg.norm(rho - s) * 1000.0,
        "v_vert_m_s": v_surf @ up,
        "v_horiz_m_s": np.linalg.norm(v_surf - (v_surf @ up) * up),
        "speed_m_s": np.linalg.norm(v_surf),
        "prop_used": desc_sol.sol(t_pdi)[6] - y[6],
        "m_end": y[6],
        "out_of_prop": y[6] <= m_min + 1e-6,
        "T_brake": T_brake, "t_pdi": t_pdi,
    }
    out["ok"] = (out["landed"] and not out["out_of_prop"]
                 and out["miss_m"] <= L["max_miss_m"]
                 and out["speed_m_s"] <= L["max_touchdown_speed_m_s"])
    if record:
        out["segments"] = segs
        out["events"] = events
    return out


def _search_landing(desc_sol, t_pdi_nom, m_min, fast):
    """Przegląd chwili rozpoczęcia hamowania (PDI) i czasu hamowania. Zwraca (czy_ok, dt, T)."""

    best_ok, best_any = None, None
    for dt in (-120, -60, 0, 60, 120):
        for T in range(300, 801, 50):
            o = descent_sim(desc_sol, t_pdi_nom + dt, float(T), m_min, fast=fast)
            score = o["miss_m"] + 100 * o["speed_m_s"] + (1e6 if not o["landed"] else 0)
            if best_any is None or score < best_any[0]:
                best_any = (score, dt, T)
            if o["ok"] and (best_ok is None or o["prop_used"] < best_ok[0]):
                best_ok = (o["prop_used"], dt, T)

    base = best_ok if best_ok is not None else best_any
    # doprecyzowanie wokół najlepszego punktu
    for dt in (base[1] - 30, base[1], base[1] + 30):
        for T in (base[2] - 25, base[2], base[2] + 25):
            o = descent_sim(desc_sol, t_pdi_nom + dt, float(T), m_min, fast=fast)
            if o["ok"] and (best_ok is None or o["prop_used"] < best_ok[0]):
                best_ok = (o["prop_used"], dt, T)

    pick = best_ok if best_ok is not None else best_any
    return best_ok is not None, pick[1], pick[2]


def plan_landing(desc_sol, t_pdi_nom, m_min):
    """
    Wybór chwili PDI i czasu hamowania. Kandydatów przegląda szybka symulacja (luźna
    tolerancja); wybrany wariant sprawdza dokładna. Jeśli szybkie przeszukiwanie nie
    znajdzie poprawnego lądowania albo dokładna symulacja go nie potwierdzi, całe
    przeszukiwanie jest powtarzane dokładną symulacją.
    """

    found, dt, T = _search_landing(desc_sol, t_pdi_nom, m_min, fast=True)
    if found:
        out = descent_sim(desc_sol, t_pdi_nom + dt, float(T), m_min, record=True)
        if out["ok"]:
            return out
    _, dt, T = _search_landing(desc_sol, t_pdi_nom, m_min, fast=False)
    return descent_sim(desc_sol, t_pdi_nom + dt, float(T), m_min, record=True)


class SurfaceSol:
    """'Rozwiązanie' dla postoju na powierzchni: punkt obraca się razem z Księżycem."""

    def __init__(self, mass):
        self.mass = mass

    def sol(self, ts):
        ts = np.atleast_1d(ts)
        out = []
        for t in ts:
            s, vs = site_state(t)
            r = EPH.moon(t) + s
            v = EPH.moon_v(t) + vs
            out.append(np.concatenate([r, v, [self.mass]]))
        return np.array(out).T


# ============================================================
# WYNIKI
# ============================================================

def sample_segments(segments, tL):
    """Próbkuje wszystkie segmenty lotu do jednej tabeli."""

    rows = []
    for name, sol, ta, tb in segments:
        if name.startswith("Ascent"):
            step = SIMULATION["output_step_ascent_s"]
        elif name.startswith("Landing"):
            step = SIMULATION["output_step_landing_s"]
        else:
            step = SIMULATION["output_step_s"]
        ts = np.arange(ta, tb, step)
        ts = np.append(ts, tb)
        ys = sol.sol(ts).T
        for t, y in zip(ts, ys):
            rows.append((t, name, y))

    t = np.array([r[0] for r in rows])
    y = np.array([r[2] for r in rows])
    phase = [r[1] for r in rows]

    # usunięcie zdublowanych chwil na granicach segmentów
    keep = np.concatenate([[True], np.diff(t) > 1e-6])
    t, y = t[keep], y[keep]
    phase = [p for p, k in zip(phase, keep) if k]

    r_geo, v_geo, m = y[:, 0:3], y[:, 3:6], y[:, 6]
    r_bary = r_geo + EPH.earth(t)
    v_bary = v_geo + EPH.earth_v(t)
    moon_geo = EPH.moon(t)
    moon_vgeo = EPH.moon_v(t)
    r_moon = r_geo - moon_geo

    site_rel = site_rel_many(t)
    site_geo = moon_geo + site_rel
    cosang = np.einsum("ij,ij->i", unit_rows(r_moon), unit_rows(site_rel))
    ground_dist = np.arccos(np.clip(cosang, -1, 1)) * R_MOON

    utc = Time(EPH.jd(t), format="jd", scale="tdb").utc.iso

    traj = pd.DataFrame({
        "Date_UTC": utc,
        "T_plus_s": t - tL,
        "Phase": phase,
        "Mass_kg": m,
        "X_km": r_bary[:, 0], "Y_km": r_bary[:, 1], "Z_km": r_bary[:, 2],
        "VX_km_s": v_bary[:, 0], "VY_km_s": v_bary[:, 1], "VZ_km_s": v_bary[:, 2],
    })

    aux = pd.DataFrame({
        "Date_UTC": utc,
        "T_plus_s": t - tL,
        "Phase": phase,
        "Altitude_Earth_km": altitude(r_geo),
        "Speed_geocentric_km_s": np.linalg.norm(v_geo, axis=1),
        "Distance_to_Moon_km": np.linalg.norm(r_moon, axis=1),
        "Altitude_Moon_km": np.linalg.norm(r_moon, axis=1) - R_MOON,
        "X_geo_km": r_geo[:, 0], "Y_geo_km": r_geo[:, 1], "Z_geo_km": r_geo[:, 2],
        "VX_geo_km_s": v_geo[:, 0], "VY_geo_km_s": v_geo[:, 1], "VZ_geo_km_s": v_geo[:, 2],
        "Mass_kg": m,
        "Moon_X_geo_km": moon_geo[:, 0], "Moon_Y_geo_km": moon_geo[:, 1], "Moon_Z_geo_km": moon_geo[:, 2],
        "Moon_VX_geo_km_s": moon_vgeo[:, 0], "Moon_VY_geo_km_s": moon_vgeo[:, 1],
        "Moon_VZ_geo_km_s": moon_vgeo[:, 2],
        "Site_X_geo_km": site_geo[:, 0], "Site_Y_geo_km": site_geo[:, 1],
        "Site_Z_geo_km": site_geo[:, 2],
        "Distance_to_site_km": ground_dist,
    })

    return traj, aux


def write_xlsx(path, sheets):
    """
    Zapis arkuszy [(nazwa, DataFrame), ...] do pliku xlsx. Z biblioteką xlsxwriter piszemy
    wiersz po wierszu (kilka razy szybciej niż pandas.to_excel); bez niej - zwykłe to_excel.
    """
    try:
        import xlsxwriter
    except ImportError:
        with pd.ExcelWriter(path) as writer:
            for name, df in sheets:
                df.to_excel(writer, sheet_name=name, index=False)
        return

    wb = xlsxwriter.Workbook(path, {"constant_memory": True, "nan_inf_to_errors": True})
    bold = wb.add_format({"bold": True})
    for name, df in sheets:
        ws = wb.add_worksheet(name)
        if not len(df.columns):
            continue
        ws.write_row(0, 0, [str(c) for c in df.columns], bold)
        cols = []
        for c in df.columns:
            s = df[c]
            if s.dtype.kind == "f":
                arr = s.to_numpy()
                lst = arr.tolist()
                for i in np.flatnonzero(np.isnan(arr)):
                    lst[i] = None
                cols.append(lst)
            else:
                cols.append(s.tolist())
        for i, row in enumerate(zip(*cols), start=1):
            ws.write_row(i, 0, row)
    wb.close()


def event_row(name, t, y, tL, ref=""):
    r, v = y[0:3], y[3:6]
    d_moon = np.linalg.norm(r - EPH.moon(t))
    v_moon = np.linalg.norm(v - EPH.moon_v(t))
    return {
        "Event": name,
        "T+ (hhh:mm:ss)": fmt_time(t - tL),
        "UTC": Time(EPH.jd(t), format="jd", scale="tdb").utc.iso[:19],
        "Alt_Earth_km": round(float(altitude(r)), 1),
        "Speed_geo_km_s": round(np.linalg.norm(v), 3),
        "Alt_Moon_km": round(d_moon - R_MOON, 1),
        "Speed_rel_Moon_km_s": round(v_moon, 3),
        "Mass_kg": round(y[6], 0),
        "Apollo 11 (for comparison)": ref,
    }


def make_plot(aux, filename):

    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed - skipping the plot.")
        return

    fig, ax = plt.subplots(2, 2, figsize=(15, 12))
    ax = ax.ravel()

    # 1) Wznoszenie
    asc = aux[aux["Phase"].str.startswith("Ascent")]
    ax[0].plot(asc["T_plus_s"], asc["Altitude_Earth_km"], label="Altitude")
    ax0b = ax[0].twinx()
    ax0b.plot(asc["T_plus_s"], asc["Speed_geocentric_km_s"], color="tab:orange")
    ax[0].set_xlabel("Time since liftoff [s]")
    ax[0].set_ylabel("Altitude [km]")
    ax0b.set_ylabel("Inertial speed [km/s]", color="tab:orange")
    ax[0].set_title("Launch and parking orbit insertion")

    R = aux[["X_geo_km", "Y_geo_km", "Z_geo_km"]].to_numpy()
    V = aux[["VX_geo_km_s", "VY_geo_km_s", "VZ_geo_km_s"]].to_numpy()
    Mo = aux[["Moon_X_geo_km", "Moon_Y_geo_km", "Moon_Z_geo_km"]].to_numpy()
    MV = aux[["Moon_VX_geo_km_s", "Moon_VY_geo_km_s", "Moon_VZ_geo_km_s"]].to_numpy()
    phase = aux["Phase"].to_numpy()

    # 2) Lot Ziemia - Księżyc (płaszczyzna lotu)
    sel = np.nonzero(phase == "Coast to the Moon")[0]
    i0 = sel[0] if len(sel) else len(R) - 1
    e1 = unit(R[i0])
    e3 = unit(np.cross(R[i0], V[i0]))
    e2 = np.cross(e3, e1)
    ax[1].plot(R @ e1 / 1e3, R @ e2 / 1e3, lw=1, label="Rocket / spacecraft")
    ax[1].plot(Mo @ e1 / 1e3, Mo @ e2 / 1e3, "--", color="gray", lw=1, label="Moon")
    ax[1].add_patch(plt.Circle((0, 0), R_EARTH / 1e3, color="tab:blue"))
    ax[1].set_aspect("equal")
    ax[1].set_xlabel("[1000 km]")
    ax[1].set_ylabel("[1000 km]")
    ax[1].set_title("Coast to the Moon (geocentric)")
    ax[1].legend(loc="best")

    # 3) Orbita Księżyca
    near = np.nonzero(aux["Distance_to_Moon_km"].to_numpy() < 20_000)[0]
    if len(near):
        rel = R[near] - Mo[near]
        orb = np.nonzero(phase == "Lunar orbit")[0]
        k = orb[0] if len(orb) else near[-1]
        rr, vv = R[k] - Mo[k], V[k] - MV[k]
        f1 = unit(rr)
        f3 = unit(np.cross(rr, vv))
        f2 = np.cross(f3, f1)
        ax[2].plot(rel @ f1, rel @ f2, lw=0.8)
        ax[2].add_patch(plt.Circle((0, 0), R_MOON, color="lightgray"))
        S = aux[["Site_X_geo_km", "Site_Y_geo_km", "Site_Z_geo_km"]].to_numpy()[near] - Mo[near]
        ax[2].plot(S[-1] @ f1, S[-1] @ f2, "r*", ms=14, label=LANDING_SITE["name"])
        ax[2].set_xlim(-4000, 4000)
        ax[2].set_ylim(-4000, 4000)
        ax[2].legend(loc="lower left")
    ax[2].set_aspect("equal")
    ax[2].set_title("Arrival, lunar orbit and descent [km]")

    # 4) Lądowanie: profil
    lnd = aux[aux["Phase"].str.startswith("Landing") | (aux["Phase"] == "On the surface")]
    if len(lnd):
        ax[3].plot(-lnd["Distance_to_site_km"], lnd["Altitude_Moon_km"] -
                   LANDING_SITE.get("elevation_m", 0) / 1000.0)
        for name, grp in lnd.groupby("Phase", sort=False):
            ax[3].plot(-grp["Distance_to_site_km"].iloc[0],
                       grp["Altitude_Moon_km"].iloc[0] - LANDING_SITE.get("elevation_m", 0) / 1000.0,
                       "o", label=name)
        ax[3].legend()
    ax[3].set_xlabel("Distance to landing site [km]")
    ax[3].set_ylabel("Altitude [km]")
    ax[3].set_title("Guided landing")
    ax[3].grid(alpha=0.3)

    fig.tight_layout()
    fig.savefig(filename, dpi=110)
    plt.close(fig)
    print(f"Plot saved: {filename}")


# ============================================================
# TRYBY MISJI: WYBÓR CZASU LOTU
# ============================================================
# Czas lotu Ziemia - Księżyc decyduje o paliwie: szybszy lot to większe Δv przy
# TLI (ostatni człon rakiety) i dużo większe Δv hamowania przy Księżycu (statek).
#   tryb "oszczedny": najdłuższy lot, który jeszcze daje zauważalną oszczędność,
#   tryb "szybki":    najkrótszy lot, na jaki starcza paliwa z rezerwami.

MODE_TITLES = {
    "oszczedny": "ECONOMY - least propellant used",
    "szybki": "FAST - shortest realistic flight time",
    "wlasny": "CUSTOM - flight time from the parameter file",
}
MODE_SHORT = {"oszczedny": "economy", "szybki": "fast", "wlasny": "custom"}

# Poprawki oszacowania względem pełnej symulacji (dobrane przez porównanie z nią):
TLI_FINITE_BURN_LOSS = 0.006        # km/s - straty skończonego czasu pracy silnika przy TLI
LOI_ESTIMATE_FACTOR = 0.98          # stożkowe sklejane zawyżają Δv hamowania o ok. 2%

# Tryb oszczędny nie zbliża się do lotu o najmniejszej energii (elipsa Hohmanna, ok. 113 h):
# tuż przy tej granicy czas lotu rośnie gwałtownie, trajektoria staje się bardzo czuła
# na celowanie, a dla orbit mocno nachylonych do orbity Księżyca (start z dużych
# szerokości) bywa wręcz nieosiągalna. Zysk z ostatnich kilkunastu godzin to ok. 0,3% paliwa.
ECONOMY_HOHMANN_FRACTION = 0.76


class TransferEstimate:
    """
    Szybkie oszacowanie (stożkowe sklejane) zależności: czas lotu -> Δv i paliwo
    dla TLI i LOI. Służy tylko do wyboru czasu lotu - wynik zawsze sprawdza
    pełna symulacja, a tryb szybki dodatkowo poprawia go na jej podstawie.
    """

    def __init__(self, trans):
        y = trans.y_ins
        self.t_ins = trans.t_ins
        self.r_p = float(np.linalg.norm(y[0:3]))
        self.v_c = float(np.linalg.norm(y[3:6]))
        self.normal = unit(np.cross(y[0:3], y[3:6]))
        self.m_park = float(y[6])
        self.m_ship = PAYLOAD["mass_kg"]
        self.ve_stage = STAGES[-1]["isp_vac_s"] * G0 / 1000.0
        self.ve_ship = CSM["isp_s"] * G0 / 1000.0
        self.r_pl = R_MOON + LUNAR_ORBIT["perilune_alt_km"]
        a_t = 0.5 * (self.r_pl + R_MOON + LUNAR_ORBIT["apolune_alt_km"])
        self.v_orbit = math.sqrt(MU_MOON * (2 / self.r_pl - 1 / a_t))
        self.cache = {}

    def __call__(self, tof_h):
        key = round(float(tof_h), 4)
        if key in self.cache:
            return self.cache[key]

        tof = tof_h * 3600.0
        t_arr = min(self.t_ins + 2.5 * 3600.0 + tof, EPH.t_max)
        rm, vm = EPH.moon(t_arr), EPH.moon_v(t_arr)
        R = float(np.linalg.norm(rm))

        # TLI: prędkość w perygeum potrzebna, by dolecieć w zadanym czasie
        v_p = vp_for_tof(self.r_p, R, tof)
        dv_tli = v_p - self.v_c + TLI_FINITE_BURN_LOSS

        # prędkość przy Księżycu względem Księżyca -> hamowanie do orbity (LOI)
        v2 = v_p ** 2 - 2 * MU_EARTH / self.r_p + 2 * MU_EARTH / R
        v_t = self.r_p * v_p / R
        v_r = math.sqrt(max(v2 - v_t ** 2, 0.0))
        vm_r = float(vm @ rm) / R
        vm_t = math.sqrt(max(float(vm @ vm) - vm_r ** 2, 0.0))
        cos_i = float(self.normal @ unit(np.cross(rm, vm)))      # nachylenie względem orbity Księżyca
        v_inf2 = (v_r - vm_r) ** 2 + v_t ** 2 + vm_t ** 2 - 2 * v_t * vm_t * cos_i
        dv_loi = (math.sqrt(v_inf2 + 2 * MU_MOON / self.r_pl) - self.v_orbit) * LOI_ESTIMATE_FACTOR

        prop_tli = self.m_park * (1 - math.exp(-dv_tli / self.ve_stage))
        prop_csm = self.m_ship * (1 - math.exp(-dv_loi / self.ve_ship))
        out = {
            "tof_h": tof_h, "dv_tli": dv_tli, "dv_loi": dv_loi, "v_inf": math.sqrt(v_inf2),
            "prop_tli": prop_tli, "prop_csm": prop_csm, "prop_total": prop_tli + prop_csm,
            "hohmann_h": math.pi * math.sqrt((0.5 * (self.r_p + R)) ** 3 / MU_EARTH) / 3600.0,
        }
        self.cache[key] = out
        return out


def last_stage_reserve_kg():
    """Paliwo, które ma zostać w ostatnim członie po TLI."""
    return STAGES[-1]["propellant_kg"] * MODE_SETTINGS["last_stage_reserve_pct"] / 100.0


def csm_margin_kg(m_csm, prop_left):
    """
    Ile paliwa statek ma ponad rezerwę na powrót (ujemne = brakuje).
    m_csm: masa statku bez lądownika, prop_left: paliwo, które w nim zostało.
    """
    k = math.exp(MODE_SETTINGS["return_reserve_dv_m_s"] / (CSM["isp_s"] * G0))
    return m_csm - (m_csm - prop_left) * k


def plan_economy(est):
    """
    Tryb oszczędny: wydłużaj lot godzina po godzinie, dopóki oszczędza to co
    najmniej 'economy_min_gain_kg_per_h' paliwa (ostatni człon + statek).
    """
    S = MODE_SETTINGS
    t_max = S["economy_tof_max_h"]
    t = min(60.0, t_max)
    cur = est(t)
    while t + 1.0 <= t_max:
        nxt = est(t + 1.0)
        if t + 1.0 > ECONOMY_HOHMANN_FRACTION * nxt["hohmann_h"]:
            break
        if cur["prop_total"] - nxt["prop_total"] < S["economy_min_gain_kg_per_h"]:
            break
        t, cur = t + 1.0, nxt
    return t


def plan_fast(est, trans):
    """
    Tryb szybki: najkrótszy lot, przy którym (wg oszacowania) ostatni człon
    zachowuje zapas paliwa, a statek - rezerwę Δv na powrót. Pełna symulacja
    koryguje potem ten wynik.
    """
    S = MODE_SETTINGS
    t_lo, t_hi = S["fast_tof_min_h"], max(S["economy_tof_max_h"], S["fast_tof_min_h"])
    budget_stage = trans.prop_left - last_stage_reserve_kg()
    mcc_allowance = est.m_ship * (1 - math.exp(-0.010 / est.ve_ship))          # ~10 m/s na korektę kursu
    budget_ship = csm_margin_kg(CSM["mass_kg"], CSM["propellant_kg"]) - mcc_allowance

    if budget_ship <= 0:
        raise RuntimeError(
            f"{CSM['name']} does not have enough propellant to keep the return reserve "
            f"({S['return_reserve_dv_m_s']:.0f} m/s) even without braking at the Moon.")

    def fits(t):
        e = est(t)
        return e["prop_tli"] <= budget_stage and e["prop_csm"] <= budget_ship

    if fits(t_lo):
        return t_lo
    if not fits(t_hi):
        return min(t_hi, ECONOMY_HOHMANN_FRACTION * est(t_hi)["hohmann_h"])      # symulacja pokaże, czego brakuje
    for _ in range(40):
        mid = 0.5 * (t_lo + t_hi)
        if fits(mid):
            t_hi = mid
        else:
            t_lo = mid
    return t_hi


def shift_tof(est, tof_h, key, extra_kg):
    """
    Czas lotu, przy którym oszacowane zużycie paliwa 'key' jest o extra_kg większe
    niż przy tof_h (extra_kg > 0 -> można lecieć szybciej, < 0 -> trzeba wolniej).
    """
    S = MODE_SETTINGS
    t_lo = S["fast_tof_min_h"]
    t_hi = max(S["economy_tof_max_h"], tof_h)
    target = est(tof_h)[key] + extra_kg
    if est(t_lo)[key] <= target:
        return t_lo
    if est(t_hi)[key] >= target:
        return t_hi
    for _ in range(40):
        mid = 0.5 * (t_lo + t_hi)
        if est(mid)[key] > target:
            t_lo = mid
        else:
            t_hi = mid
    return t_hi


def make_planner(mode, info):
    """Funkcja wybierająca czas lotu po pierwszym wyliczeniu startu (znana jest wtedy masa na orbicie)."""

    def planner(trans):
        est = TransferEstimate(trans)
        tof_h = plan_economy(est) if mode == "oszczedny" else plan_fast(est, trans)
        e = est(tof_h)
        info["est"], info["tof_h"] = est, tof_h
        print(f"  Mode {MODE_SHORT[mode]}: chosen flight time {tof_h:.1f} h "
              f"(estimate: TLI {e['dv_tli'] * 1000:.0f} m/s, LOI {e['dv_loi'] * 1000:.0f} m/s)")
        return tof_h

    return planner


# ============================================================
# DANE OD UŻYTKOWNIKA: PUNKT STARTU, PUNKT LĄDOWANIA, TRYB
# ============================================================

MODE_CHOICES = {
    "1": "oszczedny", "oszczedny": "oszczedny", "oszczędny": "oszczedny", "o": "oszczedny", "paliwo": "oszczedny", "economy": "oszczedny",
    "2": "szybki", "szybki": "szybki", "s": "szybki", "czas": "szybki", "fast": "szybki",
    "3": "oba", "oba": "oba", "b": "oba", "both": "oba",
    "4": "wlasny", "wlasny": "wlasny", "własny": "wlasny", "w": "wlasny", "custom": "wlasny",
}


def parse_coordinate(text, kind):
    """
    Zamienia tekst na stopnie. kind: 'lat' (szerokość) lub 'lon' (długość).
    Przyjmuje: 52.23   52,23   -80.6   33.9S   80.6W   21 E
    """
    s = str(text).strip().upper().replace(",", ".").replace("°", "").replace(" ", "")
    sign = 1.0
    if s and s[-1] in "NSEW":
        if s[-1] not in ("NS" if kind == "lat" else "EW"):
            raise ValueError("the letter N/S is for latitude and E/W for longitude")
        if s[-1] in "SW":
            sign = -1.0
        s = s[:-1]
    try:
        value = sign * float(s)
    except ValueError:
        raise ValueError(f"'{text}' is not a number") from None
    if not math.isfinite(value):
        raise ValueError(f"'{text}' is not a number")
    if kind == "lat":
        if not -90.0 <= value <= 90.0:
            raise ValueError("latitude must be between -90 and 90°")
    else:
        if not -360.0 <= value <= 360.0:
            raise ValueError("longitude must be between -180 and 180°")
        if not -180.0 <= value <= 180.0:
            value = (value + 180.0) % 360.0 - 180.0
    return value


def fmt_latlon(lat, lon):
    return (f"{abs(lat):.3f}°{'N' if lat >= 0 else 'S'}, "
            f"{abs(lon):.3f}°{'E' if lon >= 0 else 'W'}")


def set_site(site, lat, lon, label):
    """Podmienia współrzędne punktu. Jeśli się zmieniły, nazwa i wysokość z pliku już nie pasują."""
    lat, lon = parse_coordinate(lat, "lat"), parse_coordinate(lon, "lon")
    if abs(lat - site["lat_deg"]) < 1e-9 and abs(lon - site["lon_deg"]) < 1e-9:
        return
    site["lat_deg"], site["lon_deg"] = lat, lon
    site["name"] = label
    for key in ("alt_m", "elevation_m"):
        if key in site:
            site[key] = 0.0


def _ask_coordinate(prompt, default, kind):
    while True:
        text = input(f"  {prompt} [{default:g}]: ").strip()
        if not text:
            return default
        try:
            return parse_coordinate(text, kind)
        except ValueError as error:
            print(f"    Error: {error}. Try again.")


def ask_user(mode):
    """Pyta o punkt startu, punkt lądowania i tryb misji. Enter zostawia wartość z pliku parametrów."""

    print()
    print("-" * 70)
    print("Enter the mission data. Enter alone keeps the value in brackets [from the parameter file].")
    print("Coordinates in degrees, e.g. 52.23 or 52,23; south and west with a minus")
    print("sign or a letter: 33.9S, 80.6W.")
    try:
        print(f"\nLAUNCH SITE on Earth  (now: {LAUNCH_SITE['name']})")
        lat = _ask_coordinate("latitude ", LAUNCH_SITE["lat_deg"], "lat")
        lon = _ask_coordinate("longitude", LAUNCH_SITE["lon_deg"], "lon")
        set_site(LAUNCH_SITE, lat, lon, "User launch site")

        print(f"\nLANDING SITE on the Moon  (now: {LANDING_SITE['name']})")
        print("  longitude 0° = centre of the disc seen from Earth; above 90° or below -90°")
        print("  is the far side of the Moon")
        lat = _ask_coordinate("selenographic latitude ", LANDING_SITE["lat_deg"], "lat")
        lon = _ask_coordinate("selenographic longitude", LANDING_SITE["lon_deg"], "lon")
        set_site(LANDING_SITE, lat, lon, "User landing site")

        print("\nMISSION MODE")
        print("  1 - economy: least propellant used (slower flight)")
        print("  2 - fast:    shortest realistic flight time (more propellant)")
        print("  3 - both modes and a comparison table (takes twice as long)")
        print(f"  4 - custom:  flight time from the parameter file ({TOF_USER_H:g} h)")
        number = {"oszczedny": "1", "szybki": "2", "oba": "3", "wlasny": "4"}[mode]
        while True:
            text = input(f"  choice [{number}]: ").strip().lower()
            if not text:
                break
            if text in MODE_CHOICES:
                mode = MODE_CHOICES[text]
                break
            print("    Type 1, 2, 3 or 4.")
    except EOFError:
        print("\n(no keyboard input - keeping the values from the parameter file)")
    print("-" * 70)
    return mode


# ============================================================
# PRZEBIEG MISJI
# ============================================================

class MissionReport:
    """Bilans Δv i paliwa oraz werdykt wykonalności."""

    def __init__(self):
        self.rows = []
        self.failure = None
        self.notes = []

    def add(self, stage, dv=None, used=None, left=None, ok=True, note=""):
        self.rows.append({
            "Stage": stage,
            "Δv [m/s]": "" if dv is None else round(dv, 1),
            "Propellant used [kg]": "" if used is None else round(used, 0),
            "Propellant left [kg]": "" if left is None else round(left, 0),
            "Status": "OK" if ok else "PROBLEM",
            "Notes": note,
        })

    def table(self):
        return pd.DataFrame(self.rows)

    def verdict(self, reached_moon_orbit, landed):
        if landed:
            return "YES - the rocket will reach the Moon and land at the chosen site."
        if reached_moon_orbit:
            return "PARTLY - the spacecraft will enter lunar orbit, but the landing will fail."
        return "NO - the rocket will not reach lunar orbit."


class Flight:
    """Zapis jednego przebiegu obliczeń: odcinki trajektorii, zdarzenia, bilans."""

    def __init__(self):
        self.report = MissionReport()
        self.segments = []
        self.events = []
        self.stage = "Preparation"
        self.tL = None
        self.reached_moon_orbit = False
        self.landed = False
        self.reached_tof_h = []     # czasy lotu faktycznie osiągnięte w celowaniu


def fly_outbound(fl, tof_h, planner=None, hint=None):
    """
    Okno startowe -> start -> TLI -> korekta kursu -> wejście na orbitę Księżyca.

    tof_h:   czas lotu od TLI do Księżyca [h]
    planner: funkcja wybierająca czas lotu po pierwszym wyliczeniu startu
             (tryby "oszczedny" i "szybki"); zastępuje wtedy tof_h
    hint:    wynik poprzedniego przebiegu - przyspiesza kolejne podejście
    """

    report, segments, ev = fl.report, fl.segments, fl.events
    TLI["time_of_flight_h"] = tof_h

    # ===== 1. Okno startowe + start + TLI =====
    fl.stage = "Launch and orbit insertion"
    print("\n[1/6] Launch window, ascent and TLI targeting...")
    t_arr_h, bias, around, prev = None, 0.0, None, None
    if hint is not None:
        around, bias, prev = hint["t_launch"], hint["bias"], hint["coarse"]
        t_arr_h = hint["t_arr_h"] + (tof_h - hint["tof_h"])

    history = []                # (chwila startu [s], odchylenie Księżyca od płaszczyzny)
    for it in range(1, 9):
        if len(history) >= 2 and history[-1][1] != history[-2][1]:
            # metoda siecznych na chwili startu: szybka zbieżność także wtedy, gdy orbita
            # jest mocno nachylona do orbity Księżyca (np. start z dużych szerokości)
            (t1, f1), (t2, f2) = history[-2], history[-1]
            dt = -f2 * (t2 - t1) / (f2 - f1)
            dt = max(-1800.0, min(1800.0, dt))
            t_launch = Time(Time((t2 + dt) / 86400.0, format="jd", scale="utc").iso, scale="utc")
        else:
            t_launch = find_launch_window(t_arr_h, bias, around)
        print(f"  iteration {it}: launch {t_launch.iso[:19]} UTC")
        fl.stage = "Launch and orbit insertion"
        ascent = Ascent(t_launch)
        asc = ascent.solve()
        fl.tL = tL = ascent.tL
        fl.stage = "TLI (trans-lunar injection)"
        trans = TransLunar(asc)
        if planner is not None:
            tof_h = planner(trans)
            planner = None
            TLI["time_of_flight_h"] = tof_h
            trans.tof = tof_h * 3600.0
        c = trans.coarse(prev)
        prev = c
        y_tli = trans.coast.sol(c["t_ign"])
        n_act = unit(np.cross(y_tli[0:3], y_tli[3:6]))
        if c["r_min"] > 50_000.0 or not math.isfinite(c["tof"]):
            c["t_peri"] = c["t_ign"] + 300.0 + trans.tof      # przelot jeszcze nietrafiony: chwila planowana
        off = float(n_act @ unit(EPH.moon(c["t_peri"])))
        miss_km = abs(off) * np.linalg.norm(EPH.moon(c["t_peri"]))
        print(f"    flight time {c['tof'] / 3600:.1f} h, Moon {miss_km:.0f} km from the orbital plane")
        # poprawka okna startowego na podstawie symulacji
        t_arr_h = (c["t_peri"] - tL) / 3600.0
        f_pred, _ = moon_offplane(t_launch, t_arr_h)
        bias = off - float(f_pred)
        around = t_launch
        genuine = c["r_min"] < 50_000.0 and math.isfinite(c["tof"])
        if genuine:
            history.append((t_launch.utc.jd * 86400.0, off))
            fl.reached_tof_h.append(c["tof"] / 3600.0)
        if miss_km < 150 and genuine:
            break
        last = fl.reached_tof_h[-2:]
        if len(last) == 2 and max(last) < tof_h - 2.0:
            raise RuntimeError(
                f"A {tof_h:.1f} h flight is too slow for this geometry - from this parking orbit "
                f"at most about {max(last):.1f} h is reachable.")

    yi = asc["y_insertion"]
    pe, ap = peri_apo(yi[0:3], yi[3:6], MU_EARTH)
    segments += list(asc["segments"])
    y_start = np.concatenate([ascent.r0, ascent.v0, [ascent.m0]])
    ev.append(event_row("Liftoff", tL, y_start, tL, "1969-07-16 13:32 UTC"))
    for name, t, y in asc["events"]:
        ev.append(event_row(name, t, y, tL))
    prop_ascent = sum(s["propellant_kg"] for s in STAGES) - asc["s4b_prop_left"]
    report.add("Launch and parking orbit insertion", used=prop_ascent, left=asc["s4b_prop_left"],
               note=f"azimuth {LAUNCH_AZIMUTH_DEG:.1f}°, orbit {pe - R_EARTH:.0f} x {ap - R_EARTH:.0f} km after "
                    f"{fmt_time(asc['t_insertion'] - tL)} (propellant left: last stage)")

    tli = trans.fine(c)
    tc, tb, psi = tli["params"]
    ve4 = STAGES[-1]["isp_vac_s"] * G0
    dv_tli = ve4 * math.log(tli["m_ign"] / (tli["m_ign"] - trans.mdot * tb))
    tof_real_h = (tli["t_peri"] - tli["t_cut"]) / 3600.0
    reserve = last_stage_reserve_kg()
    print(f"  TLI: T+{fmt_time(tli['t_ign'] - tL)}, {tb:.0f} s, Δv = {dv_tli:.0f} m/s")
    segments.append(("Parking orbit", trans.coast, asc["t_insertion"], tli["t_ign"]))
    segments.append((f"TLI ({STAGES[-1]['name']})", tli["burn"], tli["t_ign"], tli["t_cut"]))
    ev.append(event_row("TLI ignition", tli["t_ign"], trans.coast.sol(tli["t_ign"]), tL, "T+002:44:16"))
    ev.append(event_row(f"TLI cutoff (Δv = {dv_tli:.0f} m/s)", tli["t_cut"], tli["y_cut"], tL,
                        "347 s, Δv ≈ 3182 m/s"))
    report.add("TLI (trans-lunar injection)", dv_tli, trans.mdot * tb, tli["prop_left"],
               ok=tli["prop_left"] >= reserve,
               note=f"flight time {tof_real_h:.1f} h; reserve required after TLI: {reserve:.0f} kg")

    # ===== 2-3. Korekta kursu + LOI (iteracyjnie: orbita nad lądowiskiem) =====
    fl.stage = "Midcourse correction and lunar orbit insertion"
    print("\n[2/6] Midcourse correction (MCC) and lunar orbit insertion (LOI)...")
    wait = LANDING["min_wait_after_loi_h"]
    t_land_est = tli["t_peri"] + wait * 3600.0 + 1800.0
    dv0 = None
    for it in range(1, 5):
        mcc = mcc_targeting(tli, t_land_est, dv0)
        dv0 = mcc["dv_vec"]
        prop_avail = CSM["propellant_kg"] - mcc["prop_used"]
        if prop_avail <= 0:
            raise RuntimeError(f"The midcourse correction needs {mcc['dv']:.0f} m/s - not enough propellant in {CSM['name']}.")
        loi = lunar_orbit_insertion(mcc, orbit_hours=wait + 5.0, prop_avail=prop_avail)
        if not loi["reached"]:
            raise RuntimeError(f"Not enough propellant in {CSM['name']} to enter lunar orbit "
                               f"(needs Δv ≈ {loi['dv']:.0f}+ m/s).")
        ov = find_overflight(loi["orbit"], loi["t_cut"] + wait * 3600.0, loi["t_end"])
        if ov is None:
            raise RuntimeError("The orbit does not pass over the landing site.")
        print(f"  iteration {it}: MCC Δv = {mcc['dv']:.1f} m/s, LOI Δv = {loi['dv']:.0f} m/s, "
              f"orbit {loi['peri_alt']:.0f} x {loi['apo_alt']:.0f} km, "
              f"passes {abs(ov['cross_km']):.2f} km from the landing site")
        if abs(ov["cross_km"]) < 0.5:
            break
        t_land_est = ov["t"]

    segments.append(("Coast to the Moon", tli["coast"], tli["t_cut"], mcc["t_mcc"]))
    segments.append(("Coast to the Moon (after correction)", mcc["coast"], mcc["t_mcc"], loi["t_ign"]))
    segments.append(("LOI (CSM braking)", loi["burn"], loi["t_ign"], loi["t_cut"]))
    ev.append(event_row(f"Midcourse correction MCC (Δv = {mcc['dv']:.1f} m/s)", mcc["t_mcc"],
                        mcc["y_mcc_after"], tL, "MCC-2 ~T+026:45, Δv ≈ 6 m/s"))
    ev.append(event_row("LOI ignition", loi["t_ign"], loi["y_ign"], tL, "~T+075:50"))
    ev.append(event_row(f"LOI cutoff (Δv = {loi['dv']:.0f} m/s)", loi["t_cut"], loi["y_cut"], tL,
                        "orbit 111 x 314 km (LOI-1)"))
    report.add("Midcourse correction (MCC)", mcc["dv"], mcc["prop_used"], prop_avail,
               note="puts the orbit over the landing site")
    report.add("Lunar orbit insertion (LOI)", loi["dv"], loi["prop_used"], loi["prop_left"],
               note=f"orbit {loi['peri_alt']:.0f} x {loi['apo_alt']:.0f} km")
    fl.reached_moon_orbit = True

    # rezerwa CSM na powrót
    need_ret = MODE_SETTINGS["return_reserve_dv_m_s"]
    m_csm = CSM["mass_kg"] - mcc["prop_used"] - loi["prop_used"]
    ve_csm = CSM["isp_s"] * G0
    dv_ret = ve_csm * math.log(m_csm / (m_csm - loi["prop_left"])) if loi["prop_left"] > 0 else 0.0
    report.add("CSM return reserve (after LM undocking)", dv_ret, None, loi["prop_left"],
               ok=dv_ret >= need_ret,
               note=f"required {need_ret:.0f} m/s (Apollo 11: return to Earth about 1000 m/s)")

    return {
        "tof_h": tof_h, "tof_real_h": tof_real_h,
        "hint": {"t_launch": t_launch, "t_arr_h": t_arr_h, "bias": bias, "coarse": c, "tof_h": tof_h},
        "t_launch": t_launch, "asc": asc, "prop_ascent": prop_ascent, "trans": trans,
        "tli": tli, "dv_tli": dv_tli, "prop_tli": trans.mdot * tb,
        "mcc": mcc, "loi": loi, "ov": ov, "m_csm": m_csm, "dv_ret": dv_ret,
    }


def fly_landing(fl, ob):
    """Odłączenie lądownika, obniżenie orbity (DOI) i lądowanie z naprowadzaniem."""

    report, segments, ev, tL = fl.report, fl.segments, fl.events, fl.tL
    loi, ov = ob["loi"], ob["ov"]

    # ===== 4. Odłączenie LM i obniżenie orbity (DOI) =====
    fl.stage = "Descent orbit insertion (DOI)"
    print("\n[3/6] Lander undocking and descent orbit insertion (DOI)...")
    r_lo = np.linalg.norm(moon_rel(ov["t"], loi["orbit"].sol(ov["t"]))[0])
    a_doi = 0.5 * (r_lo + R_MOON + LANDING["doi_perilune_alt_km"])
    t_half = math.pi * math.sqrt(a_doi ** 3 / MU_MOON)
    t_doi = ov["t"] - LANDING["pdi_lead_s"] - t_half
    if t_doi < loi["t_cut"] + 600:
        raise RuntimeError("Not enough time in orbit before DOI - increase LANDING['min_wait_after_loi_h'].")

    doi = descent_orbit_insertion(loi["orbit"], t_doi)
    print(f"  DOI: Δv = {doi['dv']:.1f} m/s, orbit {doi['peri_alt']:.1f} x {doi['apo_alt']:.1f} km")
    segments.append(("Lunar orbit", loi["orbit"], loi["t_cut"], t_doi))
    segments.append(("DOI (lander)", doi["burn"], doi["t_ign"], doi["t_cut"]))
    ev.append(event_row(f"{LANDER['name']} undocking, DOI ignition", t_doi, doi["y_ign"], tL, "DOI ~T+101:36"))
    lm_left = LANDER["propellant_kg"] - doi["prop_used"]
    report.add("Descent orbit insertion (DOI)", doi["dv"], doi["prop_used"], lm_left,
               note=f"orbit {doi['peri_alt']:.0f} x {doi['apo_alt']:.0f} km")

    # ===== 5. Lądowanie =====
    fl.stage = "Landing"
    print("\n[4/6] Landing planning (powered descent guidance)...")
    ov2 = find_overflight(doi["coast"], doi["t_cut"], doi["t_cut"] + doi["period"])
    if ov2 is None:
        raise RuntimeError("The orbit after DOI does not pass over the landing site.")
    t_pdi_nom = ov2["t"] - LANDING["pdi_lead_s"]
    m_min = LANDER["mass_kg"] - LANDER["propellant_kg"]
    lnd = plan_landing(doi["coast"], t_pdi_nom, m_min)

    segments.append(("Descent orbit", doi["coast"], doi["t_cut"], lnd["t_pdi"]))
    segments += lnd["segments"]
    y_pdi = doi["coast"].sol(lnd["t_pdi"])
    ev.append(event_row("Powered descent initiation (PDI)", lnd["t_pdi"], y_pdi, tL, "PDI ~T+102:33"))
    for name, t, y in lnd["events"]:
        ev.append(event_row(name, t, y, tL))
    lm_left -= lnd["prop_used"]
    dv_land = LANDER["isp_s"] * G0 * math.log(y_pdi[6] / lnd["m_end"])

    status = (f"distance from target {lnd['miss_m']:.0f} m, touchdown speed "
              f"{lnd['speed_m_s']:.2f} m/s (vertical {-lnd['v_vert_m_s']:.2f}, horizontal {lnd['v_horiz_m_s']:.2f})")
    print(f"  {'Touchdown' if lnd['landed'] else 'FAILED'}: {status}, "
          f"{lm_left:.0f} kg of propellant left")
    report.add("Landing (PDI -> touchdown)", dv_land, lnd["prop_used"], lm_left,
               ok=lnd["ok"], note=status)
    out = {"doi": doi, "lnd": lnd, "dv_land": dv_land, "lm_left": lm_left}

    if lnd["out_of_prop"] or not lnd["ok"]:
        # ile paliwa byłoby potrzebne? (to samo lądowanie bez limitu paliwa)
        need = plan_landing(doi["coast"], t_pdi_nom, -1e9)
        if need["ok"]:
            short = need["prop_used"] - (LANDER["propellant_kg"] - doi["prop_used"])
            if short > 0:
                raise RuntimeError(
                    f"The lander will run out of propellant: landing needs about {need['prop_used']:.0f} kg, "
                    f"available {LANDER['propellant_kg'] - doi['prop_used']:.0f} kg "
                    f"(short by ~{short:.0f} kg).")
    if lnd["crashed_early"]:
        raise RuntimeError("The lander hit the surface before the landing site.")
    if lnd["out_of_prop"]:
        raise RuntimeError(f"The lander ran out of propellant during landing ({LANDER['name']}).")
    if not lnd["landed"]:
        raise RuntimeError("The lander did not reach the surface in the planned time.")
    if lnd["miss_m"] > LANDING["max_miss_m"]:
        raise RuntimeError(f"Landed {lnd['miss_m']:.0f} m from the target (limit {LANDING['max_miss_m']:.0f} m).")
    if lnd["speed_m_s"] > LANDING["max_touchdown_speed_m_s"]:
        raise RuntimeError(f"Touchdown speed too high ({lnd['speed_m_s']:.1f} m/s).")

    fl.landed = True
    lat, lon = selenographic(lnd["t_td"], moon_rel(lnd["t_td"], lnd["y_td"])[0])
    ev.append(event_row(f"TOUCHDOWN ({lat:.3f}°, {lon:.3f}°)", lnd["t_td"], lnd["y_td"], tL,
                        "T+102:45:40 (0.674°N 23.473°E)"))
    t_end = lnd["t_td"] + SIMULATION["surface_minutes"] * 60.0
    segments.append(("On the surface", SurfaceSol(lnd["m_end"]), lnd["t_td"], t_end))
    return out


def fly_fast(planner, info, tof0):
    """
    Tryb szybki: powtarza lot do orbity Księżyca, skracając (lub wydłużając) czas
    lotu, aż zapasy paliwa ponad rezerwy będą bliskie zera. Zwraca najszybszy
    przebieg, który spełnia rezerwy (albo ostatni, jeśli żaden ich nie spełnia).
    """

    S = MODE_SETTINGS
    reserve = last_stage_reserve_kg()
    passes = max(1, int(S["fast_max_passes"]))
    best = None                 # (fl, ob) - najszybszy przebieg spełniający rezerwy
    too_fast_h = 0.0            # najdłuższy czas lotu, o którym wiadomo, że jest za krótki
    tof, hint = tof0, None
    fl = ob = None

    for p in range(1, passes + 1):
        if p > 1:
            print(f"\n--- Fast mode, pass {p}: flight time {tof:.2f} h ---")
        fl = Flight()
        try:
            ob = fly_outbound(fl, tof, planner, hint)
        except RuntimeError as error:
            tried = info.get("tof_h") if planner is not None else tof
            if best is not None:
                break
            if (tried is None or p == passes or fl.stage.startswith("Launch")
                    or tried >= S["economy_tof_max_h"]):
                return fl, None, error
            print(f"  Too fast ({error}) - making the flight longer.")
            too_fast_h = max(too_fast_h, tried)
            tof = min(S["economy_tof_max_h"], tried * 1.05 + 1.0)
            planner, hint, ob = None, None, None
            continue
        planner = None
        tof, hint = ob["tof_h"], ob["hint"]

        spare_stage = ob["tli"]["prop_left"] - reserve
        spare_ship = csm_margin_kg(ob["m_csm"], ob["loi"]["prop_left"])
        ok = spare_stage >= 0 and spare_ship >= 0
        print(f"  Flight time {tof:.2f} h: margin over reserves - {STAGES[-1]['name']} {spare_stage:+.0f} kg, "
              f"{CSM['name']} {spare_ship:+.0f} kg -> {'fits' if ok else 'TOO FAST'}")
        if ok and (best is None or tof < best[1]["tof_h"]):
            best = (fl, ob)
        if not ok:
            too_fast_h = max(too_fast_h, tof)

        # nowy czas lotu: taki, by zapas (wg nachylenia krzywej z oszacowania) spadł prawie do zera
        est = info["est"]
        t_new = max(shift_tof(est, tof, "prop_csm", spare_ship - 25.0),
                    shift_tof(est, tof, "prop_tli", spare_stage - 50.0),
                    S["fast_tof_min_h"])
        if not ok:
            t_new = max(t_new, tof + S["fast_tolerance_h"])
        if too_fast_h > 0:
            t_new = max(t_new, too_fast_h + 0.5 * S["fast_tolerance_h"])
        if best is not None and t_new > best[1]["tof_h"] - S["fast_tolerance_h"]:
            break               # szybciej się już nie da (z zadaną dokładnością)
        tof = t_new

    if best is not None:
        return best[0], best[1], None
    return fl, ob, None


def fly_economy(planner, info, tof0):
    """
    Tryb oszczędny. Bardzo wolne loty (blisko elipsy Hohmanna) są czułe na celowanie;
    jeśli nie da się wycelować w Księżyc, lot jest skracany o kilka procent
    (koszt: zwykle kilkadziesiąt kg paliwa) - najwyżej 3 razy.
    """
    fl = Flight()
    try:
        return fl, fly_outbound(fl, tof0, planner)
    except RuntimeError as error:
        last = (fl, error)
    tof = info.get("tof_h", tof0)
    for _ in range(3):
        if fl.stage.startswith("Launch"):
            break
        tof = 0.93 * tof
        if fl.reached_tof_h:
            tof = min(tof, 0.97 * max(fl.reached_tof_h))
        tof = max(MODE_SETTINGS["fast_tof_min_h"], tof)
        print(f"\n  Could not hit the target ({last[1]}) - shortening the flight to {tof:.1f} h.")
        fl = Flight()
        try:
            return fl, fly_outbound(fl, tof)
        except RuntimeError as error:
            last = (fl, error)
    last[1].flight = last[0]        # zapis nieudanego przebiegu trafia do raportu
    raise last[1]


def summarize(mode, fl, ob, land):
    """Podsumowanie misji: lista (opis, wartość, liczba miejsc po przecinku)."""

    rows = [("Mode", MODE_SHORT[mode], None)]
    if ob is not None:
        tli, mcc, loi = ob["tli"], ob["mcc"], ob["loi"]
        used = ob["prop_tli"] + mcc["prop_used"] + loi["prop_used"]
        dv = ob["dv_tli"] + mcc["dv"] + loi["dv"]
        rows += [
            ("Launch (UTC)", ob["t_launch"].iso[:19], None),
            ("Launch azimuth [°]", float(LAUNCH_AZIMUTH_DEG), 1),
            ("Flight time TLI -> Moon [h]", ob["tof_real_h"], 1),
            ("Launch -> lunar orbit [h]", (loi["t_cut"] - fl.tL) / 3600.0, 1),
        ]
        if land is not None and fl.landed:
            rows.append(("Launch -> touchdown [h]", (land["lnd"]["t_td"] - fl.tL) / 3600.0, 1))
        rows += [
            ("Δv TLI [m/s]", ob["dv_tli"], 0),
            ("Δv midcourse correction MCC [m/s]", mcc["dv"], 1),
            ("Δv lunar orbit insertion LOI [m/s]", loi["dv"], 0),
        ]
        if land is not None:
            dv_lm = land["doi"]["dv"] + land["dv_land"]
            rows.append(("Δv lander (DOI + landing) [m/s]", dv_lm, 0))
            dv += dv_lm
        rows += [
            ("Δv total from parking orbit [m/s]", dv, 0),
            ("Propellant: launch -> parking orbit [kg]", ob["prop_ascent"], 0),
            (f"Propellant: {STAGES[-1]['name']} for TLI [kg]", ob["prop_tli"], 0),
            (f"   left in {STAGES[-1]['name']} [kg]", tli["prop_left"], 0),
            (f"Propellant: {CSM['name']} for MCC + LOI [kg]", mcc["prop_used"] + loi["prop_used"], 0),
            (f"   left in {CSM['name']} [kg]", loi["prop_left"], 0),
            ("   spacecraft Δv reserve for return [m/s]", ob["dv_ret"], 0),
        ]
        if land is not None:
            lm_used = land["doi"]["prop_used"] + land["lnd"]["prop_used"]
            rows += [
                (f"Propellant: {LANDER['name']} for DOI + landing [kg]", lm_used, 0),
                (f"   left in {LANDER['name']} [kg]", land["lm_left"], 0),
            ]
            used += lm_used
        rows.append(("Propellant total from parking orbit [kg]", used, 0))
    rows.append(("Will it reach the Moon and land?", fl.report.verdict(fl.reached_moon_orbit, fl.landed).split(" - ")[0], None))
    return rows


def fmt_value(value, digits):
    if value is None:
        return "-"
    if digits is None:
        return str(value)
    return f"{value:,.{digits}f}".replace(",", " ")


def summary_table(summaries):
    """Tabela: wiersze = wielkości, kolumny = tryby (+ różnica, gdy tryby są dwa)."""

    labels = []
    for rows in summaries.values():
        labels += [r[0] for r in rows if r[0] not in labels]
    table = {"Quantity": labels}
    lookup = {mode: {r[0]: r for r in rows} for mode, rows in summaries.items()}
    for mode in summaries:
        table[MODE_SHORT[mode]] = [fmt_value(*lookup[mode][lab][1:]) if lab in lookup[mode] else "-"
                                   for lab in labels]
    if len(summaries) == 2:
        a, b = list(summaries)
        diff = []
        for lab in labels:
            ra, rb = lookup[a].get(lab), lookup[b].get(lab)
            if ra and rb and ra[2] is not None and not lab.startswith("Launch azimuth"):
                d = rb[1] - ra[1]
                diff.append(("+" if d >= 0 else "-") + fmt_value(abs(d), ra[2]))
            else:
                diff.append("")
        table[f"difference ({MODE_SHORT[b]} - {MODE_SHORT[a]})"] = diff
    return pd.DataFrame(table)


def table_text(df):
    """Tabela jako tekst: pierwsza kolumna do lewej, pozostałe do prawej."""
    cols = list(df.columns)
    width = [max([len(str(c))] + [len(str(v)) for v in df[c]]) for c in cols]
    rows = [[str(c) for c in cols]] + [[str(v) for v in row] for row in df.itertuples(index=False)]
    out = []
    for row in rows:
        out.append((row[0].ljust(width[0]) + "".join("   " + v.rjust(w) for v, w in zip(row[1:], width[1:]))).rstrip())
    return "\n".join(out)


def run_mission(mode, prefix):
    """Liczy całą misję w jednym trybie i zapisuje wyniki z danym prefiksem nazw plików."""

    global LAUNCH_AZIMUTH_DEG

    S = MODE_SETTINGS
    set_output_names(prefix)

    print()
    print("=" * 70)
    print(f"  MODE {MODE_TITLES[mode]}")
    print("=" * 70)

    m0 = (sum(s["dry_kg"] + s["propellant_kg"] for s in STAGES)
          + PAYLOAD["mass_kg"] + PAYLOAD["les_mass_kg"])
    twr = stage_mdot(STAGES[0]) * STAGES[0]["isp_sl_s"] * G0 / (m0 * G0)

    fl = Flight()
    ob = land = None
    info = {}

    try:
        if twr <= 1.0:
            raise RuntimeError(f"First-stage thrust too low for liftoff (T/W = {twr:.2f} ≤ 1).")

        # Czas lotu: w trybach automatycznych to tylko wartość początkowa -
        # właściwą wybiera 'planner' po pierwszym wyliczeniu startu.
        if mode == "oszczedny":
            tof0 = min(100.0, S["economy_tof_max_h"])
        elif mode == "szybki":
            tof0 = max(52.0, S["fast_tof_min_h"])
        else:
            tof0 = TOF_USER_H
        TLI["time_of_flight_h"] = tof0

        fl.stage = "Launch window"
        if isinstance(AZIMUTH_SETTING, str):
            LAUNCH_AZIMUTH_DEG, incl = choose_azimuth(default_arrival_hours())
            print(f"Launch azimuth chosen automatically: {LAUNCH_AZIMUTH_DEG:.1f}° "
                  f"(orbit inclination {incl:.1f}°)")
        else:
            LAUNCH_AZIMUTH_DEG = float(AZIMUTH_SETTING)
            print(f"Launch azimuth from the parameter file: {LAUNCH_AZIMUTH_DEG:.1f}°")

        if mode == "szybki":
            fl, ob, error = fly_fast(make_planner(mode, info), info, tof0)
            if error is not None:
                raise error
        elif mode == "oszczedny":
            fl, ob = fly_economy(make_planner(mode, info), info, tof0)
        else:
            ob = fly_outbound(fl, tof0)

        land = fly_landing(fl, ob)

    except RuntimeError as error:
        fl = getattr(error, "flight", fl)
        fl.report.failure = (fl.stage, str(error))

    # ===== 6. Wyniki =====
    print("\n[5/6] Saving results...")
    report = fl.report
    verdict = report.verdict(fl.reached_moon_orbit, fl.landed)
    budget = report.table()
    events = pd.DataFrame(fl.events) if fl.events else pd.DataFrame()
    summary = summarize(mode, fl, ob, land)
    summary_df = summary_table({mode: summary})

    traj = aux = None
    if fl.segments:
        traj, aux = sample_segments(fl.segments, fl.tL)
        traj.to_csv(OUTPUT_CSV, index=False)
        aux.to_csv(OUTPUT_AUX_CSV, index=False)
        print(f"  trajectory (ICRF, barycentric): {OUTPUT_CSV} ({len(traj)} rows)")
        print(f"  data for the viewer:            {OUTPUT_AUX_CSV}")
        try:
            write_xlsx(OUTPUT_XLSX, [
                ("Verdict", pd.DataFrame({"Verdict": [verdict]})),
                ("Summary", summary_df),
                ("dv and propellant budget", budget),
                ("Events", events),
                ("Trajectory ICRF", traj),
                ("Auxiliary data", aux),
            ])
            print(f"  workbook:                       {OUTPUT_XLSX}")
        except ImportError:
            print("  openpyxl not installed - skipping the Excel file")
        make_plot(aux, OUTPUT_PNG)

    lines = []
    lines.append("=" * 70)
    lines.append(f"MODE {MODE_TITLES[mode]}")
    lines.append(f"Launch:    {LAUNCH_SITE['name']} ({fmt_latlon(LAUNCH_SITE['lat_deg'], LAUNCH_SITE['lon_deg'])})")
    lines.append(f"Landing:   {LANDING_SITE['name']} ({fmt_latlon(LANDING_SITE['lat_deg'], LANDING_SITE['lon_deg'])})")
    lines.append("=" * 70)
    lines.append("FLIGHT TIMELINE")
    lines.append("=" * 70)
    if len(events):
        with pd.option_context("display.width", 250, "display.max_columns", 20):
            lines.append(events.to_string(index=False))
    lines.append("")
    lines.append("=" * 70)
    lines.append("Δv AND PROPELLANT BUDGET")
    lines.append("=" * 70)
    if len(budget):
        with pd.option_context("display.width", 250, "display.max_columns", 20,
                               "display.max_colwidth", 90):
            lines.append(budget.to_string(index=False))
    lines.append("")
    lines.append("=" * 70)
    lines.append("SUMMARY")
    lines.append("=" * 70)
    lines.append(table_text(summary_df).split("\n", 1)[1])
    lines.append("")
    lines.append("=" * 70)
    lines.append(f"WILL IT REACH THE MOON AND LAND?  {verdict}")
    if report.failure:
        lines.append(f"Reason: [{report.failure[0]}] {report.failure[1]}")
    lines.append("=" * 70)

    text = "\n".join(lines)
    print("\n[6/6] Result\n" + text)
    with open(OUTPUT_REPORT, "w", encoding="utf-8") as f:
        f.write(text + "\n")

    return {"mode": mode, "verdict": verdict, "landed": fl.landed, "budget": budget, "events": events,
            "summary": summary, "trajectory": traj, "aux": aux, "failure": report.failure}


def main(param_file="parametry_misji.py", launch=None, landing=None, mode=None, ask=None):
    """
    param_file: plik z parametrami misji
    launch:     (szerokość, długość) punktu startu na Ziemi [°] - zastępuje plik
    landing:    (szerokość, długość) punktu lądowania na Księżycu [°] - zastępuje plik
    mode:       "oszczedny", "szybki", "oba" lub "wlasny" - zastępuje plik
    ask:        True/False - czy pytać o te dane z klawiatury; domyślnie pyta
                (ASK_USER w pliku), chyba że podano launch, landing lub mode
    """

    global EPH

    load_parameters(param_file)
    if len(STAGES) < 2:
        raise ValueError("The rocket must have at least 2 stages.")

    chosen = MODE_CHOICES.get(str(mode if mode is not None else MISSION_MODE).strip().lower())
    if chosen is None:
        raise ValueError("The mission mode must be one of: oszczedny, szybki, oba, wlasny.")
    if launch is not None:
        set_site(LAUNCH_SITE, launch[0], launch[1], "User launch site")
    if landing is not None:
        set_site(LANDING_SITE, landing[0], landing[1], "User landing site")

    print("=" * 70)
    print("  MOON MISSION - SIMULATION AND FEASIBILITY CHECK")
    print("=" * 70)
    print(f"Parameters from file: {param_file}")

    if ask is None:
        ask = bool(ASK_USER) and launch is None and landing is None and mode is None
    if ask:
        chosen = ask_user(chosen)
    modes = ["oszczedny", "szybki"] if chosen == "oba" else [chosen]

    m_dry = sum(s["dry_kg"] for s in STAGES)
    m_prop = sum(s["propellant_kg"] for s in STAGES)
    m0 = m_dry + m_prop + PAYLOAD["mass_kg"] + PAYLOAD["les_mass_kg"]
    twr = stage_mdot(STAGES[0]) * STAGES[0]["isp_sl_s"] * G0 / (m0 * G0)
    azimuth = "chosen automatically" if isinstance(AZIMUTH_SETTING, str) else f"{AZIMUTH_SETTING}°"

    print(f"Launch:    {LAUNCH_SITE['name']} ({fmt_latlon(LAUNCH_SITE['lat_deg'], LAUNCH_SITE['lon_deg'])}), "
          f"azimuth {azimuth}")
    print(f"Landing:   {LANDING_SITE['name']} ({fmt_latlon(LANDING_SITE['lat_deg'], LANDING_SITE['lon_deg'])})")
    print("Mode:      " + " and ".join(MODE_SHORT[m] for m in modes))
    parts = ", ".join("{} {:.1f} t".format(s["name"], s["dry_kg"] / 1000) for s in STAGES)
    print(f"Rocket dry mass: {m_dry / 1000:.1f} t ({parts}), propellant {m_prop / 1000:.1f} t")
    print(f"Spacecraft: {CSM['name']} {CSM['mass_kg'] / 1000:.1f} t + "
          f"{LANDER['name']} {LANDER['mass_kg'] / 1000:.1f} t")
    print(f"Liftoff mass: {m0 / 1000:.1f} t,  T/W = {twr:.2f}")

    # --- Efemerydy (jeden raz, na najdłuższy z liczonych lotów) ---
    tof_span = max(MODE_SETTINGS["economy_tof_max_h"] if m != "wlasny" else TOF_USER_H for m in modes)
    t_early = Time(EARLIEST_LAUNCH_UTC, scale="utc")
    jd_start = t_early.tdb.jd - 0.5
    total_days = (LAUNCH_SEARCH_DAYS + TLI["coast_max_h"] / 24 + tof_span / 24
                  + 12 / 24 + LANDING["min_wait_after_loi_h"] / 24 + 10 / 24 + 1.0)
    span_days = math.ceil((total_days + 0.5) / 5.0) * 5.0      # zaokrąglenie: wspólna pamięć podręczna dla trybów
    EPH = load_ephemeris(jd_start, jd_start + span_days)
    print(f"Ephemeris source: {EPH.source}")

    prefix = OUTPUT_PREFIX
    results = {}
    for m in modes:
        results[m] = run_mission(m, prefix if len(modes) == 1 else f"{prefix}_{m}")

    if len(modes) == 1:
        return results[modes[0]]

    # --- Porównanie trybów ---
    table = summary_table({m: results[m]["summary"] for m in modes})
    lines = ["=" * 70, "MODE COMPARISON",
             f"Launch:    {LAUNCH_SITE['name']} ({fmt_latlon(LAUNCH_SITE['lat_deg'], LAUNCH_SITE['lon_deg'])})",
             f"Landing:   {LANDING_SITE['name']} ({fmt_latlon(LANDING_SITE['lat_deg'], LANDING_SITE['lon_deg'])})",
             "=" * 70]
    lines.append(table_text(table))
    lines.append("=" * 70)
    text = "\n".join(lines)
    print("\n" + text)
    with open(f"{prefix}_porownanie.txt", "w", encoding="utf-8") as f:
        f.write(text + "\n")
    table.to_csv(f"{prefix}_porownanie.csv", index=False, encoding="utf-8-sig")
    print(f"Comparison saved: {prefix}_porownanie.txt, {prefix}_porownanie.csv")

    results["comparison"] = table
    return results


def _options_from_argv():
    """
    Opcje z linii poleceń. W Jupyterze sys.argv zawiera argumenty jądra
    (np. '-f kernel.json'), więc nieznane argumenty są pomijane.
    """
    import sys

    args = sys.argv[1:]
    opts = {"param_file": "parametry_misji.py"}
    i = 0
    while i < len(args):
        arg = args[i]
        if arg.endswith(".py"):
            opts["param_file"] = arg
        elif arg in ("--start", "--ladowanie") and i + 2 < len(args):
            try:
                pair = (parse_coordinate(args[i + 1], "lat"), parse_coordinate(args[i + 2], "lon"))
            except ValueError as error:
                raise SystemExit(f"Error in {arg}: {error}. Example: {arg} 28.6084 -80.6043")
            opts["launch" if arg == "--start" else "landing"] = pair
            i += 2
        elif arg == "--tryb" and i + 1 < len(args):
            if args[i + 1].lower() not in MODE_CHOICES:
                raise SystemExit("Error in --tryb: choose oszczedny, szybki, oba or wlasny.")
            opts["mode"] = args[i + 1]
            i += 1
        elif arg == "--bez-pytan":
            opts["ask"] = False
        elif arg == "--pytaj":
            opts["ask"] = True
        i += 1
    return opts


if __name__ == "__main__":
    main(**_options_from_argv())