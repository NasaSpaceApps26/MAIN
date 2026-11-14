from app.schemas.bodies import Body

# radius_km (volumetric mean) and flattening come from the NASA planetary fact sheets
BODIES: list[Body] = [
    Body(id="sun", name="Sun", horizons_id="10", radius_km=695700, flattening=0.0, rotation_period_h=609.12, color="#ffcc33"),
    Body(id="mercury", name="Mercury", horizons_id="199", radius_km=2439.7, flattening=0.0009, rotation_period_h=1407.6, color="#9e9e9e"),
    Body(id="venus", name="Venus", horizons_id="299", radius_km=6051.8, flattening=0.0, rotation_period_h=-5832.5, color="#e8cda2"),
    Body(id="earth", name="Earth", horizons_id="399", radius_km=6371.0, flattening=0.003353, rotation_period_h=23.9345, color="#2f6fdf"),
    Body(id="moon", name="Moon", horizons_id="301", radius_km=1737.4, flattening=0.0012, rotation_period_h=655.72, color="#bbbbbb"),
    Body(id="mars", name="Mars", horizons_id="499", radius_km=3389.5, flattening=0.00589, rotation_period_h=24.6229, color="#c1440e"),
    Body(id="jupiter", name="Jupiter", horizons_id="599", radius_km=69911, flattening=0.06487, rotation_period_h=9.925, color="#d8ca9d"),
    Body(id="saturn", name="Saturn", horizons_id="699", radius_km=58232, flattening=0.09796, rotation_period_h=10.656, color="#e3d6a7"),
    Body(id="uranus", name="Uranus", horizons_id="799", radius_km=25362, flattening=0.02293, rotation_period_h=-17.24, color="#9fe3e8"),
    Body(id="neptune", name="Neptune", horizons_id="899", radius_km=24622, flattening=0.01708, rotation_period_h=16.11, color="#4166f5"),
]

_BY_ID = {b.id: b for b in BODIES}


def get_body(body_id: str) -> Body | None:
    return _BY_ID.get(body_id)
