"""
PARAMETRY MISJI NA KSIĘŻYC
==========================

To jedyny plik, który trzeba edytować. Po zmianach uruchom:

    python misja.py                      (używa tego pliku)
    python misja.py moje_parametry.py    (inny plik z parametrami)

Program zapyta o punkt startu, punkt lądowania i tryb misji (Enter zostawia
wartości z tego pliku), sprawdzi, czy rakieta doleci i wyląduje w wybranym
punkcie, policzy trajektorię oraz bilans Δv i paliwa, a wyniki zapisze do plików.

Wartości domyślne odpowiadają misji Apollo 11 (Saturn V + CSM + LM).
"""

# ============================================================
# 0. TRYB MISJI I SPOSÓB PODAWANIA DANYCH
# ============================================================

ASK_USER = True          # True  = program pyta o punkt startu, lądowania i tryb
                         # False = bierze wszystko z tego pliku (bez pytań)

MISSION_MODE = "oba"     # "oszczedny" - najmniejsze zużycie paliwa (wolniejszy lot)
                         # "szybki"    - najkrótszy realistyczny czas dolotu
                         # "oba"       - liczy oba tryby i porównuje je w tabeli
                         # "wlasny"    - czas lotu wpisany niżej w TLI["time_of_flight_h"]

MODE_SETTINGS = {
    # --- tryb oszczędny: lot wydłużany, dopóki opłaca się to paliwowo ---
    "economy_tof_max_h": 120.0,          # najdłuższy dopuszczalny lot TLI -> Księżyc [h]
    "economy_min_gain_kg_per_h": 10.0,   # wydłużaj lot, dopóki każda godzina oszczędza tyle paliwa [kg]

    # --- tryb szybki: najkrótszy lot, na jaki starcza paliwa z rezerwami ---
    "fast_tof_min_h": 36.0,              # najkrótszy dopuszczalny lot TLI -> Księżyc [h]
    "fast_tolerance_h": 0.25,            # dokładność szukania najkrótszego lotu [h]
    "fast_max_passes": 4,                # ile razy program może powtórzyć obliczenia, szukając granicy

    # --- rezerwy paliwa (to one czynią tryb szybki "realistycznym") ---
    "last_stage_reserve_pct": 1.0,       # zapas w ostatnim członie po TLI [% jego paliwa]
    "return_reserve_dv_m_s": 1000.0,     # Δv, które statek musi zachować na powrót na Ziemię [m/s]
}

# ============================================================
# 1. PUNKT STARTU (Ziemia, WGS84)
# ============================================================
# Wartości domyślne - program zapyta o szerokość i długość przy uruchomieniu.
# Inne przykłady:  Bajkonur: (45.920, 63.342),  Kourou: (5.239, -52.768)

LAUNCH_SITE = {
    "name": "Kennedy Space Center, LC-39A",
    "lat_deg": 28.6084,      # szerokość geograficzna [°], + północ
    "lon_deg": -80.6043,     # długość geograficzna [°], + wschód
    "alt_m": 0.0,            # wysokość [m]
}

LAUNCH_AZIMUTH_DEG = "auto"  # "auto" = program sam dobiera kierunek startu do miejsca startu
                             #          (jak najbliżej wschodu, by wykorzystać obrót Ziemi);
                             # liczba = azymut wymuszony, 90 = na wschód (Apollo 11: 72°)

EARLIEST_LAUNCH_UTC = "2025-01-02 00:00:00"   # od kiedy szukać okna startowego
LAUNCH_SEARCH_DAYS = 3.0                      # ile dni przeszukiwać


# ============================================================
# 2. PUNKT LĄDOWANIA (Księżyc, współrzędne selenograficzne)
# ============================================================
# Wartości domyślne - program zapyta o szerokość i długość przy uruchomieniu.

LANDING_SITE = {
    "name": "Sea of Tranquility (Apollo 11)",
    "lat_deg": 0.674,        # szerokość [°], + północ
    "lon_deg": 23.473,       # długość [°], + wschód (0° = środek tarczy widocznej z Ziemi)
    "elevation_m": 0.0,      # wysokość terenu względem średniego promienia (1737,4 km)
}
# Inne przykłady:  Apollo 12: (-3.012, -23.422),  Apollo 15: (26.132, 3.634),
#                  Apollo 17: (20.191, 30.772),   Chang'e 3: (44.12, -19.51)


# ============================================================
# 3. RAKIETA NOŚNA - człony w kolejności pracy
# ============================================================
# Możesz dodać lub usunąć człony. Ostatni człon wykonuje też TLI
# (drugi zapłon - wyrzucenie w stronę Księżyca).

STAGES = [
    {
        "name": "S-IC",                 # 1. człon
        "dry_kg": 135_000.0,            # masa konstrukcji (bez paliwa)
        "propellant_kg": 2_077_000.0,   # masa paliwa
        "thrust_vac_N": 38_850_000.0,   # ciąg w próżni
        "isp_vac_s": 304.0,             # impuls właściwy w próżni
        "isp_sl_s": 263.0,              # impuls właściwy na poziomie morza
    },
    {
        "name": "S-II",                 # 2. człon
        "dry_kg": 40_100.0,
        "propellant_kg": 456_100.0,
        "thrust_vac_N": 5_141_000.0,
        "isp_vac_s": 421.0,
        "isp_sl_s": 200.0,
    },
    {
        "name": "S-IVB",                # 3. człon (orbita parkingowa + TLI)
        "dry_kg": 14_900.0,
        "propellant_kg": 109_500.0,
        "thrust_vac_N": 1_033_100.0,
        "isp_vac_s": 421.0,
        "isp_sl_s": 200.0,
    },
]

AERO = {
    "diameter_m": 10.1,      # średnica rakiety
    "drag_coeff": 0.5,       # współczynnik oporu
}

PAYLOAD = {
    "les_mass_kg": 4_200.0,              # wieża ratunkowa (odrzucana); 0 = brak
    "les_jettison_after_s2_ign_s": 30.0,
}


# ============================================================
# 4. STATEK KOSMICZNY
# ============================================================

# Statek główny (korekty kursu, wejście na orbitę Księżyca, powrót)
CSM = {
    "name": "CSM (Columbia)",
    "mass_kg": 28_800.0,        # masa całkowita z paliwem
    "propellant_kg": 18_400.0,  # paliwo silnika SPS (wliczone w mass_kg)
    "thrust_N": 91_200.0,
    "isp_s": 314.0,
}

# Lądownik (obniżenie orbity i lądowanie)
LANDER = {
    "name": "LM (Eagle)",
    "mass_kg": 15_100.0,        # masa całkowita z paliwem
    "propellant_kg": 8_200.0,   # paliwo silnika lądowania (wliczone w mass_kg)
    "thrust_N": 45_040.0,       # maksymalny ciąg
    "isp_s": 311.0,
    "min_throttle": 0.10,       # minimalna moc silnika (ułamek ciągu)
}


# ============================================================
# 5. PROFIL LOTU
# ============================================================

ASCENT = {
    "vertical_rise_s": 12.0,    # lot pionowy po starcie
    "pitch_kick_deg": "auto",   # pochylenie po starcie [°]; "auto" = dobierane do miejsca startu tak,
                                # by 1. człon kończył pracę na wysokości stage1_cutoff_alt_km
    "stage1_cutoff_alt_km": 62.0,   # (Apollo/Saturn V: ok. 60-68 km)
    "kick_duration_s": 10.0,
}

PARKING_ORBIT_ALT_KM = 185.0

TLI = {
    "coast_min_h": 1.4,         # min. czas na orbicie parkingowej
    "coast_max_h": 4.5,         # maks. czas na orbicie parkingowej
    "time_of_flight_h": 73.0,   # czas lotu od TLI do Księżyca - tylko dla trybu "wlasny"
                                # (tryby "oszczedny" i "szybki" dobierają go same)
}

MCC = {
    "after_tli_h": 24.0,        # kiedy wykonać korektę kursu (ustawia orbitę nad lądowiskiem)
}

LUNAR_ORBIT = {
    "perilune_alt_km": 111.0,   # orbita po wejściu (LOI)
    "apolune_alt_km": 111.0,
}

LANDING = {
    "min_wait_after_loi_h": 2.0,    # min. czas na orbicie przed lądowaniem (Apollo 11: ~25 h)
    "doi_perilune_alt_km": 15.0,    # obniżenie orbity przed lądowaniem (DOI)
    "pdi_lead_s": 290.0,            # o ile wcześniej niż przelot nad lądowiskiem zacząć hamowanie

    # punkty pośrednie naprowadzania (jak w Apollo: hamowanie -> podejście -> zejście pionowe)
    "high_gate_alt_m": 2_300.0,
    "high_gate_range_m": 8_000.0,
    "high_gate_speed_m_s": 120.0,   # prędkość pozioma w high gate
    "high_gate_sink_m_s": 35.0,     # prędkość opadania w high gate
    "approach_time_s": 120.0,
    "low_gate_alt_m": 30.0,
    "vertical_time_s": 30.0,
    "touchdown_speed_m_s": 1.0,

    # kryteria udanego lądowania
    "max_miss_m": 500.0,            # dopuszczalna odległość od wybranego punktu
    "max_touchdown_speed_m_s": 3.0,
}


# ============================================================
# 6. SYMULACJA I WYNIKI
# ============================================================

SIMULATION = {
    "output_step_s": 60.0,           # krok zapisu trajektorii
    "output_step_ascent_s": 2.0,     # krok zapisu podczas startu
    "output_step_landing_s": 1.0,    # krok zapisu podczas lądowania
    "surface_minutes": 10.0,         # ile minut po przyziemieniu zapisać
    "ephemeris_step": "1 hour",
}

EPHEMERIS_SOURCE = "auto"   # "horizons", "astropy" lub "auto"

OUTPUT_PREFIX = "misja"     # nazwy plików wynikowych: misja_trajektoria.csv itd.