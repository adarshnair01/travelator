// Place search and reverse lookup with OpenStreetMap's Nominatim service,
// plus suggestions while typing from Photon.
// Usage policy: at most one request per second, no autocomplete-per-keystroke,
// and attribution to OpenStreetMap. Searches run only when the user submits.
const BASE = 'https://nominatim.openstreetmap.org';

let last = 0;
async function politeFetch(url, signal) {
    const wait = Math.max(0, last + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Place search failed (${res.status})`);
    return res.json();
}

const lang = () => (typeof navigator !== 'undefined' && navigator.language) || 'en';

const areaName = (a = {}) => a.city || a.town || a.village || a.suburb || a.county || a.state;

const shortName = (r) => r.name || areaName(r.address) || (r.display_name || '').split(',')[0] || 'Unnamed place';

// Kinds of places worth naming a stop after when someone clicks right on them.
const SIGHT_CATEGORIES = new Set(['tourism', 'historic', 'leisure', 'natural', 'waterway', 'boundary', 'aeroway', 'railway']);
const SIGHT_AMENITIES = new Set(['place_of_worship', 'university', 'theatre', 'arts_centre', 'marketplace', 'ferry_terminal', 'bus_station']);
const isSight = (r) => Boolean(r.name) && (SIGHT_CATEGORIES.has(r.category) || (r.category === 'amenity' && SIGHT_AMENITIES.has(r.type)));

export async function searchPlaces(query, signal) {
    const url = `${BASE}/search?format=jsonv2&addressdetails=1&limit=6&accept-language=${encodeURIComponent(lang())}&q=${encodeURIComponent(query)}`;
    const rows = await politeFetch(url, signal);
    return rows.map((r) => ({
        name: shortName(r),
        detail: r.display_name,
        lat: Number(r.lat),
        lng: Number(r.lon),
    }));
}

export async function reverseLookup(lat, lng, signal) {
    // Ask at street level: a click on a landmark (a fort, a temple, a beach) gets the
    // landmark's name; anywhere else gets the town or city.
    const url = `${BASE}/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=${encodeURIComponent(lang())}&lat=${lat}&lon=${lng}`;
    try {
        const r = await politeFetch(url, signal);
        if (r && !r.error) return isSight(r) ? r.name : (areaName(r.address) || shortName(r));
    } catch {
        // fall through to coordinates
    }
    return `${lat.toFixed(3)}, ${lng.toFixed(3)}`;
}

// ---- Suggestions while typing ------------------------------------------------------
// Nominatim doesn't allow search-as-you-type, so suggestions come from Photon
// (komoot's open search built on OpenStreetMap, made for autocomplete). Results are
// nudged towards the latest stop, so famous places nearby come up first.
const PHOTON = 'https://photon.komoot.io/api/';
const PHOTON_LANGS = ['en', 'de', 'fr', 'it'];

const isLandmark = (key, value) => SIGHT_CATEGORIES.has(key) || (key === 'amenity' && SIGHT_AMENITIES.has(value));

export async function suggestPlaces(query, near, signal) {
    const want = lang().split('-')[0];
    const params = new URLSearchParams({ q: query, limit: '7', lang: PHOTON_LANGS.includes(want) ? want : 'en' });
    if (near) {
        params.set('lat', near.lat.toFixed(4));
        params.set('lon', near.lng.toFixed(4));
    }
    const res = await fetch(`${PHOTON}?${params}`, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Suggestions failed (${res.status})`);
    const data = await res.json();
    const seen = new Set();
    return (data.features || [])
        .map((f) => {
            const p = f.properties || {};
            const [lng, lat] = f.geometry?.coordinates || [];
            const name = p.name || [p.street, p.housenumber].filter(Boolean).join(' ');
            const detail = [p.city, p.county, p.state, p.country].filter((x, i, arr) => x && x !== name && arr.indexOf(x) === i).slice(0, 3).join(', ');
            return { name, detail, lat, lng, landmark: isLandmark(p.osm_key, p.osm_value) };
        })
        .filter((r) => r.name && Number.isFinite(r.lat) && Number.isFinite(r.lng))
        .filter((r) => { const k = `${r.name}|${r.detail}`; if (seen.has(k)) return false; seen.add(k); return true; });
}
