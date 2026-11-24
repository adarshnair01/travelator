// Place search and reverse lookup with OpenStreetMap's Nominatim service,
// plus famous sights near a place from the Overpass API.
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

// ---- Famous spots nearby ----------------------------------------------------------
// Well-known sights around a place, from OpenStreetMap via the Overpass API. Only
// sights linked to Wikidata are asked for, which keeps the list to notable ones.
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const TOURISM = 'attraction|museum|viewpoint|theme_park|zoo|aquarium|gallery';
const HISTORIC = 'monument|castle|fort|palace|archaeological_site|memorial|ruins|city_gate|temple';
const sightsCache = new Map();

export function famousNearby(lat, lng, signal) {
    const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
    if (sightsCache.has(key)) return sightsCache.get(key);
    const around = `around:25000,${lat},${lng}`;
    const query = `[out:json][timeout:20];(` +
        `nwr["tourism"~"^(${TOURISM})$"]["name"]["wikidata"](${around});` +
        `nwr["historic"~"^(${HISTORIC})$"]["name"]["wikidata"](${around});` +
        `nwr["natural"~"^(beach|waterfall|peak)$"]["name"]["wikipedia"](${around});` +
        `);out center tags 80;`;
    const job = fetch(OVERPASS, {
        method: 'POST',
        body: new URLSearchParams({ data: query }),
        signal,
    }).then(async (res) => {
        if (!res.ok) throw new Error(`Sights lookup failed (${res.status})`);
        const data = await res.json();
        const want = lang().split('-')[0];
        const seen = new Set();
        return (data.elements || [])
            .map((el) => {
                const t = el.tags || {};
                return {
                    name: t[`name:${want}`] || t['name:en'] || t.name,
                    lat: el.lat ?? el.center?.lat,
                    lng: el.lon ?? el.center?.lon,
                    // Sights with a Wikipedia article in more places tend to be the famous ones
                    score: (t.wikipedia ? 2 : 0) + (t.tourism === 'attraction' ? 1 : 0) + (t.historic ? 1 : 0) + (t.heritage ? 1 : 0),
                };
            })
            .filter((p) => p.name && Number.isFinite(p.lat) && Number.isFinite(p.lng))
            .filter((p) => { const k = p.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
            .sort((a, b) => b.score - a.score || a.name.length - b.name.length)
            .slice(0, 8);
    });
    sightsCache.set(key, job);
    job.catch(() => sightsCache.delete(key));
    return job;
}
