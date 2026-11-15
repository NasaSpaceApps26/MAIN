/**
 * Lets other parts of the app hand the camera over to CameraFollow without the usual jump.
 * Normally selecting a body makes the camera jump to ~8 radii from it. When a camera move of
 * its own (like the flight overview) ends by selecting a body, set `keepPositionFor` to that
 * body's id first: CameraFollow then leaves the camera where it is and only travels with the body.
 *
 * `panning` is true while the flight overview moves the camera by itself (MissionScene): FlyCamera
 * then does not carry the camera along with a nearby body, the pull-back places it every frame.
 */
export const followControl = {
  keepPositionFor: null as string | null,
  panning: false,
}
