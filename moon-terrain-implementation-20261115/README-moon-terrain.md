# Księżyc: teren LOLA + zaznaczanie punktów

Pakiet zawiera PEŁNE wersje 13 plików, przygotowane dla projektu C:\Users\mikeb\MAIN.
Każdy istniejący plik zastępujesz w całości. Trzy pliki oznaczone NOWY należy utworzyć.
Kod aplikacji w projekcie nie został automatycznie podmieniony.

## Pliki

- NOWY: backend/app/services/moon_terrain.py
- NOWY: backend/app/api/routes/terrain.py
- ZASTĄP CAŁY: backend/app/api/router.py
- NOWY: frontend/src/components/SolarSystem/EarthMoon/moonTerrain.ts
- ZASTĄP CAŁY: frontend/src/components/SolarSystem/EarthMoon/tileMesh.ts
- ZASTĄP CAŁY: frontend/src/components/SolarSystem/EarthMoon/globeMesh.ts
- ZASTĄP CAŁY: frontend/src/components/SolarSystem/EarthMoon/TileTree.ts
- ZASTĄP CAŁY: frontend/src/components/SolarSystem/EarthMoon/TiledSurface.tsx
- ZASTĄP CAŁY: frontend/src/store/simStore.ts
- ZASTĄP CAŁY: frontend/src/components/SolarSystem/CelestialBody.tsx
- ZASTĄP CAŁY: frontend/src/components/SolarSystem/FlyCamera.tsx
- ZASTĄP CAŁY: frontend/src/components/SolarSystem/SurfaceReadout.tsx
- ZASTĄP CAŁY: frontend/src/components/SolarSystem/SiteMarkers.tsx

## Instalacja w PowerShell

Najpierw zachowaj kopię obecnych plików lub zrób commit. Poniższe polecenie rozpakowuje pełne pliki bezpośrednio do projektu i nadpisuje te 10 istniejących plików.

```powershell
cd C:\Users\mikeb\MAIN
Expand-Archive -LiteralPath .\moon-terrain-implementation-20261115.zip -DestinationPath . -Force
docker compose -f docker/docker-compose.yml restart backend frontend
Invoke-RestMethod -Uri 'http://localhost:8000/api/terrain/moon/v1/metadata.json' -TimeoutSec 300
```

Ostatnie polecenie przygotowuje dane i powinno zwrócić metadata: width 5760, height 2880, reference_radius_m 1737400.
Pierwsze przygotowanie pobiera około 66 MB TIFF z NASA i może potrwać kilka minut.
Następnie otwórz http://localhost:5173 i wykonaj Ctrl+F5.
Alternatywnie skopiuj ręcznie katalogi backend i frontend z tego pakietu do MAIN, scalając katalogi i zastępując wymienione pliki.

Wymagane biblioteki numpy, requests i Pillow są już w backend/requirements.txt.
Ta implementacja odczytuje TIFF przez Pillow; nie wymaga instalowania tifffile ani matplotlib.
Nie uruchamia się osobno skryptu Python z poprzedniej wiadomości: backend sam przygotowuje model.

## Co działa

- Zdjęcia Księżyca i ich poziomy przybliżenia nadal obsługuje obecny adapter QuickMap.
- Teren ma prawdziwe wysokości w metrach względem sfery o promieniu 1737400 m.
- Siatki kafelków oraz podgląd całego globu są deformowane; bieguny korzystają z tego samego DEM.
- Zachowane jest obecne wyprzedzające ładowanie kafelków zdjęć.
- Wysokości pobierane są jednorazowo jako około 33 MB binarnego DEM; kolejne przybliżenia nie pobierają ich ponownie w tej sesji. Przeglądarka może potem wykorzystać swój HTTP cache.
- Kamera uwzględnia teren, obrót Księżyca i wybraną skalę; zachowuje minimum 2 m wysokości nad modelem.
- Obecne znaczniki miejsc księżycowych są osadzane według DEM.
- Shift + kliknięcie powierzchni Księżyca zaznacza własny punkt. Panel pokazuje współrzędne i wysokość; Clear point usuwa zaznaczenie.
- Zaznaczenie nie zmienia obecnej listy miejsc lądowania ani jej identyfikatorów.

## Punkt dla przyszłego planowania

Stan Zustand frontend/src/store/simStore.ts:
pickedMoonPoint: MoonPoint | null
setMoonPoint(point: MoonPoint | null): void

MoonPoint zawiera:
latDeg, lonDeg, elevationM, datasetId

Dostęp w kodzie:
const point = useSimStore.getState().pickedMoonPoint

Współrzędne odnoszą się do obracającego się układu Księżyca, nie do nieruchomej sceny.
elevationM jest wysokością względem sfery 1737.4 km, a nie wysokością kamery i nie absolutnym promieniem.
datasetId określa źródło wysokości.
Funkcje moonHeight(lat, lon), moonPosition(lat, lon, radius, liftM) i moonUnitRadius(lat, lon) są wspólnym źródłem wysokości dla terenu, kamery i punktów.
Teren jest deformowany na CPU, więc standardowy raycasting Three.js widzi jego geometrię.
Kliknięcia w pionowe osłony szczelin przy krawędziach kafelków są odrzucane.
Wybrany punkt żyje w stanie aplikacji do odświeżenia strony; nie jest jeszcze zapisywany do bazy ani przekazywany do obliczeń trajektorii.

## Rozdzielczość i ograniczenia

Źródło: NASA SVS / LOLA LDEM16:
https://svs.gsfc.nasa.gov/4720/
https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16.tif

To globalna siatka 16 pikseli na stopień: około 1.9 km na równiku.
Góry i duże kratery otrzymują geometrię. Drobne kratery i kamienie widoczne na bardzo szczegółowych zdjęciach QuickMap nie otrzymują z tego pliku własnej geometrii.
Interpolacja i kwantyzacja nie zwiększają rzeczywistej rozdzielczości pomiarów.
To podstawa wizualizacji i zaznaczania punktów, nie model do oceny bezpieczeństwa lądowania.
Dla dokładniejszego planowania potrzebne będą regionalne DEM i aktualizacja wspólnego samplera wraz z jego identyfikatorem.
Zdjęcia i pomiary wysokości pochodzą z różnych produktów, więc drobne cechy mogą nie pasować idealnie.
Na odległych poziomach siatka jest uproszczona; po przybliżeniu reprezentuje DEM gęściej.
Ziemia korzysta z dotychczasowej geometrii.

## Pamięć podręczna i błędy

Backend zapisuje źródłowy TIFF, heights.bin i metadata.json w settings.cache_dir / moon_terrain_v1.
Przy kolejnym uruchomieniu wykorzystuje przygotowane pliki.
W czasie przygotowania glob jest widoczny, lecz szczegółowe kafelki księżycowe i wybór punktu terenu czekają na kompletny DEM.
Przy błędzie pobierania pojawia się komunikat i przycisk Retry.
Logi:
docker compose -f docker/docker-compose.yml logs --tail 120 backend

## Weryfikacja tej wersji

- Pełne sprawdzenie TypeScript aplikacji z podmienionymi plikami: OK.
- Odczyt prawdziwego TIFF NASA 5760x2880: OK.
- Wysokości źródłowe: -8981.501 m do 10685.5 m.
- Test kodowania 16-bit: maksymalny błąd w sprawdzonych próbkach około 0.151 m. To błąd kodowania, nie dokładność pomiarów LOLA.
- Testy wykonania JS: ładowanie i współdzielenie pobierania, szew +/-180°, bieguny, jednostki, geometria kafelków, zgodność styku czap i pasa, kolizja kamery przy obrocie i wszystkich skalach, wybór punktu i odrzucanie kliknięć w osłony szczelin: OK.
- Nie przeprowadzono pełnego testu wizualnego w działającej przeglądarce po podmianie plików.
