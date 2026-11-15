/**
 * What each zoomable globe shows right below the camera: the map level (the same numbers as
 * Moon Trek's zoom levels) and how many metres one pixel of it covers.
 * TiledSurface writes it every frame, the altitude readout reads it a few times a second.
 * A plain object, not React state, so writing it 60 times a second costs nothing.
 */
export const surfaceBelowCamera: Partial<
  Record<'earth' | 'moon', { level: number; metresPerPixel: number }>
> = {}
