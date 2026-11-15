import numpy as np

from app.services.site_model import ground_grid, normalize


def test_ground_grid_is_north_up_east_right():
    lat, lon = ground_grid(10.0, 20.0, 5, span_km=40)
    assert abs(lat[2, 2] - 10.0) < 1e-9 and abs(lon[2, 2] - 20.0) < 1e-9  # site in the middle
    assert lat[0, 2] > lat[2, 2] > lat[4, 2]  # row 0 is the north edge
    assert lon[2, 0] < lon[2, 2] < lon[2, 4]  # column 0 is the west edge
    # 20 km north is 20 km of arc on the 1737.4 km sphere
    assert abs((lat[0, 2] - 10.0) - np.degrees(20_000 / 1_737_400)) < 1e-9


def test_ground_grid_near_the_pole_and_seam():
    lat, lon = ground_grid(-89.9, 0.0, 5, span_km=40)
    assert lat[0, 2] > -89.9  # "north" points away from the south pole
    assert lat.min() >= -90
    lat, lon = ground_grid(0.0, 179.99, 5, span_km=40)
    assert lon[2, 4] < 0 < lon[2, 0]  # east of the seam wraps to -180°


def test_normalize():
    assert normalize(90, 190) == (89.999, -170.0)
