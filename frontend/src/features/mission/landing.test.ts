import { describe, expect, it } from 'vitest'
import type { Site } from '../../api/types'
import { PRIMARY_SLOT, landingLabel, landingLetter } from './landing'

const point = (latDeg: number, lonDeg: number, siteId: string | null = null) => ({
  latDeg,
  lonDeg,
  elevationM: 0,
  datasetId: 'test',
  siteId,
})

const tycho = { id: 'tycho-site', name: 'Tycho', lat_deg: -43.3, lon_deg: -11.2 } as Site

describe('landing names', () => {
  it('A is the primary landing, B, C… the alternatives', () => {
    expect(PRIMARY_SLOT).toBe(0)
    expect(['A', 'B', 'C', 'F'].map((l, i) => landingLetter([0, 1, 2, 5][i]) === l)).toEqual([true, true, true, true])
  })

  it('names a point of your own by its letter', () => {
    expect(landingLabel(point(5, 60), 0)).toBe('Landing A')
    expect(landingLabel(point(5, 61), 2)).toBe('Landing C')
  })

  it('adds the named place a landing is on', () => {
    expect(landingLabel(point(-43.3, -11.2, 'tycho-site'), 1, [tycho])).toBe('Landing B · Tycho')
    // picked by its coordinates (Lunar Sky map, typed in): still named
    expect(landingLabel(point(-43.31, -11.21), 1, [tycho])).toBe('Landing B · Tycho')
  })

  it('says when a slot is still empty', () => {
    expect(landingLabel(null, 1)).toBe('Landing B: not set')
  })
})
