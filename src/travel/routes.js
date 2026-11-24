// Route shapes for car and train legs, as [lng, lat] points that stay on land.
//
// Car legs follow real roads from the public OSRM demo server (OpenStreetMap data).
// Train legs use the same corridor, smoothed into long sweeps, since there is no free
// rail router. If routing fails (no road between the places, or the service is down)
// we fall back to a drawn curve, choosing the shape that keeps the most of it on land.
// Flights keep their arc in the reel and have no stored route.
import { geoBounds, geoContains, geoMercator, geoPath } from 'd3-geo';
import { curvePoints, distanceKm, legSeed, mercX, mercY } from './geo';
import { loadWorld } from './world';

const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const TIMEOUT_MS = 10000;
const MAX_POINTS = 400;

export const routeKey = (from, to, mode) =>
    `${mode}:${from.lat.toFixed(5)},${from.lng.toFixed(5)}>${to.lat.toFixed(5)},${to.lng.toFixed(5)}`;

// ---- Land test ------------------------------------------------------------------

let landIndex = null;
async function getLand() {
    if (landIndex) return landIndex;
    const world = await loadWorld();
    // Bounding boxes first, so each point is only tested against nearby countries
    landIndex = world.land.features.map((f) => ({ f, b: geoBounds(f) }));
    return landIndex;
}

const inBox = ([lng, lat], [[w, s], [e, n]]) =>
    lat >= s && lat <= n && (w <= e ? lng >= w && lng <= e : lng >= w || lng <= e);

const onLand = (land, p) => land.some(({ f, b }) => inBox(p, b) && geoContains(f, p));

// Share of the route (ignoring the first and last few points, where coastal
// stops can sit just off the simplified coastline) that is over water.
function seaShare(land, pts) {
    const skip = Math.max(1, Math.floor(pts.length * 0.04));
    let sea = 0, n = 0;
    for (let i = skip; i < pts.length - skip; i += 1) {
        n += 1;
        if (!onLand(land, pts[i])) sea += 1;
    }
    return n ? sea / n : 0;
}

// ---- Shapes ---------------------------------------------------------------------

const toLngLat = ([x, y]) => [(x * 180) / Math.PI, (Math.atan(Math.sinh(y)) * 180) / Math.PI];

// Drawn curve in Mercator space (so it matches the reel), tried with smaller and
// mirrored bends. Returns the shape with the least water, and how much water that is.
async function bestCurve(from, to, mode) {
    const land = await getLand();
    const a = [mercX(from.lng), mercY(from.lat)];
    const b = [mercX(to.lng), mercY(to.lat)];
    const seed = legSeed(from, to);
    let best = null;
    for (const amp of [1, 0.6, 0.3, 0]) {
        for (const flip of amp ? [false, true] : [false]) {
            const pts = curvePoints(a, b, mode, seed, { samples: 90, upIsNegativeY: false, amp: flip ? -amp : amp }).map(toLngLat);
            const share = seaShare(land, pts);
            if (!best || share < best.share) best = { pts, share };
            if (share === 0) return best;
        }
    }
    return best;
}

// Overland path for legs where a simple curve would cross the sea (a curving coast,
// a bay). The land around the leg is drawn into a small grid, the cheapest path over
// land cells is found (A*), kept away from the coast so smoothing can't push it
// offshore, then simplified and rounded. Returns null when no overland path exists.
async function overlandPath(from, to) {
    const world = await loadWorld();
    const ax = mercX(from.lng), ay = mercY(from.lat), bx = mercX(to.lng), by = mercY(to.lat);
    const span = Math.max(Math.abs(bx - ax), Math.abs(by - ay), 1e-4);
    const margin = span * 0.6;
    const minX = Math.min(ax, bx) - margin, maxX = Math.max(ax, bx) + margin;
    const minY = Math.min(ay, by) - margin, maxY = Math.max(ay, by) + margin;
    const N = 180;
    const cell = Math.max(maxX - minX, maxY - minY) / N;
    const W = Math.ceil((maxX - minX) / cell), H = Math.ceil((maxY - minY) / cell);

    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H });
    const ctx = canvas.getContext('2d');
    const projection = geoMercator().scale(1 / cell).translate([-minX / cell, maxY / cell]);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    geoPath(projection, ctx)(world.land);
    ctx.fill();
    const px = ctx.getImageData(0, 0, W, H).data;
    const isLand = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i += 1) isLand[i] = px[i * 4 + 3] > 127 ? 1 : 0;

    // Distance (in cells) from the sea, by breadth-first search from every water cell
    const dist = new Int32Array(W * H).fill(-1);
    let queue = [];
    for (let i = 0; i < W * H; i += 1) if (!isLand[i]) { dist[i] = 0; queue.push(i); }
    while (queue.length) {
        const next = [];
        for (const i of queue) {
            const x = i % W, y = (i / W) | 0;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const j = ny * W + nx;
                if (dist[j] < 0) { dist[j] = dist[i] + 1; next.push(j); }
            }
        }
        queue = next;
    }
    for (let i = 0; i < W * H; i += 1) if (dist[i] < 0) dist[i] = W + H; // all land: far from any sea

    const toCell = (x, y) => [Math.min(W - 1, Math.max(0, Math.floor((x - minX) / cell))), Math.min(H - 1, Math.max(0, Math.floor((maxY - y) / cell)))];
    // Coastal stops can sit in a "water" cell of the simplified coastline: start from the nearest land
    const nearestLand = ([cx, cy]) => {
        for (let r = 0; r <= 8; r += 1) {
            for (let dy = -r; dy <= r; dy += 1) for (let dx = -r; dx <= r; dx += 1) {
                const x = cx + dx, y = cy + dy;
                if (x >= 0 && y >= 0 && x < W && y < H && isLand[y * W + x]) return y * W + x;
            }
        }
        return -1;
    };
    const start = nearestLand(toCell(ax, ay));
    const goal = nearestLand(toCell(bx, by));
    if (start < 0 || goal < 0) return null;

    // A* over land cells; steps close to the coast cost more
    const gx = goal % W, gy = (goal / W) | 0;
    const g = new Float64Array(W * H).fill(Infinity);
    const came = new Int32Array(W * H).fill(-1);
    const heap = [];
    const push = (i, f) => {
        heap.push([f, i]);
        let k = heap.length - 1;
        while (k > 0) { const p = (k - 1) >> 1; if (heap[p][0] <= heap[k][0]) break; [heap[p], heap[k]] = [heap[k], heap[p]]; k = p; }
    };
    const pop = () => {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
            heap[0] = last;
            let k = 0;
            for (;;) {
                const l = 2 * k + 1, r = l + 1;
                let m = k;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === k) break;
                [heap[m], heap[k]] = [heap[k], heap[m]];
                k = m;
            }
        }
        return top;
    };
    g[start] = 0;
    push(start, 0);
    const steps = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    let found = false;
    while (heap.length) {
        const [, i] = pop();
        if (i === goal) { found = true; break; }
        const x = i % W, y = (i / W) | 0;
        for (const [dx, dy, len] of steps) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = ny * W + nx;
            if (!isLand[j]) continue;
            const cost = g[i] + len * (1 + 3 / Math.min(dist[j], 6));
            if (cost < g[j]) {
                g[j] = cost;
                came[j] = i;
                push(j, cost + Math.hypot(nx - gx, ny - gy));
            }
        }
    }
    if (!found) return null;

    const cells = [];
    for (let i = goal; i >= 0; i = came[i]) cells.push(i);
    cells.reverse();
    const merc = cells.map((i) => [minX + ((i % W) + 0.5) * cell, maxY - (((i / W) | 0) + 0.5) * cell]);
    const rounded = smooth(simplify(merc, cell * 2.5));
    return [[from.lng, from.lat], ...rounded.slice(1, -1).map(toLngLat), [to.lng, to.lat]];
}

// The offline fallback: a drawn curve if it stays on land, else an overland path.
async function landSafeShape(from, to, mode) {
    const curve = await bestCurve(from, to, mode);
    if (curve.share === 0) return curve.pts;
    try {
        const path = await overlandPath(from, to);
        if (path && seaShare(await getLand(), path) < curve.share) return path;
    } catch {
        // no canvas (very old browser): keep the curve
    }
    return curve.pts;
}

// Ramer–Douglas–Peucker in degrees.
function simplify(pts, tol) {
    if (pts.length < 3) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
        const [i, j] = stack.pop();
        const [x1, y1] = pts[i], [x2, y2] = pts[j];
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1e-12;
        let far = -1, idx = -1;
        for (let k = i + 1; k < j; k += 1) {
            const d = Math.abs(dy * pts[k][0] - dx * pts[k][1] + x2 * y1 - y2 * x1) / len;
            if (d > far) { far = d; idx = k; }
        }
        if (far > tol) { keep[idx] = 1; stack.push([i, idx], [idx, j]); }
    }
    return pts.filter((_, k) => keep[k]);
}

// Chaikin corner cutting: turns a road's corners into smooth rail-like sweeps.
function smooth(pts, rounds = 3) {
    let out = pts;
    for (let r = 0; r < rounds; r += 1) {
        const next = [out[0]];
        for (let i = 0; i < out.length - 1; i += 1) {
            const [x1, y1] = out[i], [x2, y2] = out[i + 1];
            next.push([0.75 * x1 + 0.25 * x2, 0.75 * y1 + 0.25 * y2], [0.25 * x1 + 0.75 * x2, 0.25 * y1 + 0.75 * y2]);
        }
        next.push(out[out.length - 1]);
        out = next;
    }
    return out;
}

function capPoints(pts, startTol) {
    let tol = startTol, out = simplify(pts, tol);
    while (out.length > MAX_POINTS) { tol *= 1.6; out = simplify(pts, tol); }
    return out;
}

// ---- Road routing ---------------------------------------------------------------

let lastCall = 0;
async function roadRoute(from, to, signal) {
    // The demo server asks for at most one request a second
    const wait = Math.max(0, lastCall + 1100 - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const url = `${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!res.ok) throw new Error(`Routing failed (${res.status})`);
    const data = await res.json();
    const route = data.routes?.[0];
    if (data.code !== 'Ok' || !route) throw new Error('No road between these places');
    // Snapped far from either place (an island, open sea) or a wild detour: not a real road trip
    const straight = distanceKm(from, to);
    if ((data.waypoints || []).some((w) => w.distance > 30000)) throw new Error('No road nearby');
    if (route.distance / 1000 > Math.max(straight * 4, straight + 150)) throw new Error('Road detour too long');
    return route.geometry.coordinates;
}

const cache = new Map();

/** Land-following [lng, lat] points from `from` to `to`, or null for flights. */
export function getRoute(from, to, mode, signal) {
    if (mode !== 'car' && mode !== 'train') return Promise.resolve(null);
    const key = routeKey(from, to, mode);
    if (!cache.has(key)) {
        const job = (async () => {
            const spanDeg = Math.hypot(to.lng - from.lng, to.lat - from.lat);
            let pts;
            try {
                const road = await roadRoute(from, to, signal);
                if (mode === 'car') {
                    pts = capPoints(road, spanDeg * 0.0015);
                } else {
                    // Rail-like: keep only the big shape of the corridor, then round it off.
                    // If rounding cuts across a bay, fall back to the road's own shape.
                    const land = await getLand();
                    const roadLite = capPoints(road, spanDeg * 0.004);
                    const rounded = smooth(simplify(road, spanDeg * 0.02));
                    pts = seaShare(land, rounded) <= seaShare(land, roadLite) ? rounded : roadLite;
                }
            } catch (e) {
                if (signal?.aborted) throw e;
                pts = await landSafeShape(from, to, mode);
            }
            // Always start and end exactly on the stops
            return [[from.lng, from.lat], ...pts.slice(1, -1), [to.lng, to.lat]];
        })();
        cache.set(key, job);
        job.catch(() => cache.delete(key));
    }
    return cache.get(key);
}
