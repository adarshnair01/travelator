// Build a trip from a batch of photos, using the location and time phones save
// inside each photo (EXIF). Everything is read on the device; nothing is uploaded.
import { distanceKm, TIMING } from './geo';

const STOP_RADIUS_KM = 15; // photos closer than this to a stop's centre belong to it

/** Where and when a photo was taken: { lat, lng, time } (any may be null). */
export async function readPhotoInfo(file) {
    let lat = null, lng = null, time = null;
    try {
        const { default: exifr } = await import('exifr/dist/lite.esm.mjs');
        const tags = await exifr.parse(file, { gps: true, exif: true, ifd0: true, xmp: false, icc: false, iptc: false, jfif: false });
        if (tags) {
            if (Number.isFinite(tags.latitude) && Number.isFinite(tags.longitude) && !(tags.latitude === 0 && tags.longitude === 0)) {
                lat = tags.latitude;
                lng = tags.longitude;
            }
            const taken = tags.DateTimeOriginal || tags.CreateDate || tags.DateTime;
            if (taken instanceof Date && !Number.isNaN(taken.getTime())) time = taken.getTime();
        }
    } catch {
        // not a format with readable metadata: treat as no location
    }
    return { lat, lng, time };
}

/**
 * Group photos into stops in the order they were taken.
 * photos: [{ lat, lng, time, ... }] (all with a location).
 * Returns stops: [{ lat, lng, photos: [...], wayPhotos: [...] }].
 * A single photo taken between two stops (on a highway, from a train window)
 * becomes a photo on the way to the next stop instead of a stop of its own.
 */
export function groupIntoStops(photos) {
    const sorted = [...photos].sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity));
    const groups = [];
    sorted.forEach((p) => {
        const g = groups[groups.length - 1];
        if (g && distanceKm(g, p) <= STOP_RADIUS_KM) {
            g.members.push(p);
            const n = g.members.length;
            g.lat += (p.lat - g.lat) / n;
            g.lng += (p.lng - g.lng) / n;
        } else {
            groups.push({ lat: p.lat, lng: p.lng, members: [p] });
        }
    });

    const stops = [];
    let pendingWay = [];
    groups.forEach((g, i) => {
        const lone = g.members.length === 1 && i > 0 && i < groups.length - 1;
        if (lone && stops.length) {
            pendingWay.push(g.members[0]);
            return;
        }
        stops.push({ lat: g.lat, lng: g.lng, members: g.members, way: pendingWay });
        pendingWay = [];
    });

    return stops.map((s) => {
        // Name the stop after the photo closest to its centre
        const anchor = s.members.reduce((best, p) => (distanceKm(s, p) < distanceKm(s, best) ? p : best), s.members[0]);
        return {
            lat: s.lat,
            lng: s.lng,
            anchor,
            photos: pickEvenly(s.members, TIMING.maxPhotos),
            extra: s.members.length - Math.min(s.members.length, TIMING.maxPhotos) + Math.max(0, s.way.length - TIMING.maxWayPhotos),
            wayPhotos: pickEvenly(s.way, TIMING.maxWayPhotos),
        };
    });
}

// Keep at most n items, spread over the whole list (first and last included).
function pickEvenly(items, n) {
    if (items.length <= n) return items;
    if (n === 1) return [items[0]];
    return Array.from({ length: n }, (_, k) => items[Math.round((k * (items.length - 1)) / (n - 1))]);
}

/** A sensible default way of travelling for a leg of this length. */
export const guessMode = (km) => (km > 600 ? 'flight' : 'car');

/**
 * Place photos with a time but no location: each goes to the stop whose photos
 * were taken closest in time, if it has room. Returns the photos left over.
 */
export function placeByTime(stops, unlocated) {
    const left = [];
    unlocated.forEach((p) => {
        if (p.time == null) { left.push(p); return; }
        let best = null, gap = Infinity;
        stops.forEach((s) => {
            s.photos.forEach((q) => {
                if (q.time != null && Math.abs(q.time - p.time) < gap) { gap = Math.abs(q.time - p.time); best = s; }
            });
        });
        // Only within a day of a located photo, and only if the stop has room
        if (best && gap < 24 * 3600 * 1000 && best.photos.length < TIMING.maxPhotos) best.photos.push(p);
        else left.push(p);
    });
    stops.forEach((s) => s.photos.sort((a, b) => (a.time ?? 0) - (b.time ?? 0)));
    return left;
}
