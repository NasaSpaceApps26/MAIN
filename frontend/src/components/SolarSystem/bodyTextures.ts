// Bodies with a NASA texture in public/textures/<id>.png.
// A missing file crashes the scene, so only list ones that exist.
// Earth and Moon stay out: they will get LOD tiles later.
export const TEXTURE_IDS = new Set([
  'sun',
  'mercury',
  'venus',
  'mars',
  'jupiter',
  'saturn',
  'uranus',
  'neptune',
])
