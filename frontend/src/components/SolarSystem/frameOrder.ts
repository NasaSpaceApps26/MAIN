/**
 * The order of the per-frame updates in the space view (useFrame priorities: lower runs first; all
 * negative, so react-three-fiber still renders by itself). Within one frame:
 *  1. clock   – the mission clock advances
 *  2. flight  – the computed flight places the spacecraft (and runs the overview pull-back)
 *  3. follow  – CameraFollow carries the camera with the followed body or the spacecraft
 *  4. fly     – FlyCamera applies the keys and the mouse, then keeps the camera out of the bodies
 * Everything else (bodies, labels, readouts) runs at 0, once the camera has its final place.
 *
 * Without a fixed order they ran in the order the components happened to mount: the camera then
 * aimed at where the spacecraft was a frame earlier, and the collision checked the camera against
 * planets that had already moved on while the camera had not been carried along yet (it got
 * shoved to another spot every frame while the clock ran).
 */
export const FRAME_ORDER = { clock: -4, flight: -3, follow: -2, fly: -1 } as const
