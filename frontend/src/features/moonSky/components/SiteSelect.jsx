/** Landing-site picker; choosing a site sets lat/lon (the map and the settings form follow). */
export default function SiteSelect({ sites, siteId, onChange }) {
  return (
    <label className="site-select">
      Landing site
      <select value={siteId ?? ''} onChange={(e) => {
        const s = sites.find((x) => x.id === e.target.value);
        if (s) onChange({ lat: s.lat, lon: s.lon });
      }}>
        <option value="">— custom location —</option>
        {sites.map((s) => (
          <option key={s.id} value={s.id}>{s.name} ({s.year}, {s.region})</option>
        ))}
      </select>
    </label>
  );
}
