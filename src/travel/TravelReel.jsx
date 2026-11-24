import { useMemo } from 'react';
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { geoMercator, geoPath, geoGraticule10 } from 'd3-geo';
import { Plane, TrainFront, Car, Motorbike, Bus, MapPin, Camera } from 'lucide-react';
import {
    REEL, MODES, TIMING, buildTimeline, cameraAt, segmentAt, legProgress, legPath,
    toPathD, headingDeg, project, clamp01, pointBack, wayPhotoAt, wayPoint,
} from './geo';
import { getWorld } from './world';
import { ReelTheme, useReelTheme, themeFor } from './themes';

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
// Colours shared by every map style (vehicles, markers, highlights)
const C = {
    gold: '#f0c34e',
};
const ICONS = { flight: Plane, train: TrainFront, car: Car, bike: Motorbike, bus: Bus };

const fmtKm = (km) => `${Math.round(km).toLocaleString('en-IN')} km`;

// ---------------------------------------------------------------------------
// Map layer: land and borders, clipped to the frame so each frame stays light,
// drawn in the chosen style (with a texture for the comic, manga and ink styles).

// Textures for the sea and land in the illustrated styles
const Patterns = () => (
    <defs>
        <pattern id="tex-halftone" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="5.5" cy="5.5" r="3.2" fill="#ffffff" opacity="0.45" />
            <circle cx="16.5" cy="16.5" r="3.2" fill="#ffffff" opacity="0.45" />
        </pattern>
        <pattern id="tex-hatch" width="14" height="14" patternUnits="userSpaceOnUse">
            <line x1="0" y1="7" x2="14" y2="7" stroke="#111111" strokeWidth="1.2" opacity="0.55" />
        </pattern>
        <pattern id="tex-speed" width="40" height="12" patternUnits="userSpaceOnUse">
            <line x1="0" y1="3" x2="26" y2="3" stroke="#000000" strokeWidth="1.6" opacity="0.7" />
            <line x1="18" y1="9" x2="40" y2="9" stroke="#000000" strokeWidth="1" opacity="0.45" />
        </pattern>
        <pattern id="tex-tone" width="10" height="10" patternUnits="userSpaceOnUse">
            <circle cx="2.5" cy="2.5" r="1.6" fill="#000000" opacity="0.5" />
            <circle cx="7.5" cy="7.5" r="1.6" fill="#000000" opacity="0.5" />
        </pattern>
    </defs>
);

const MapLayer = ({ cam }) => {
    const T = useReelTheme();
    const world = getWorld();
    const paths = useMemo(() => {
        const centerLng = (cam.cx * 180) / Math.PI;
        const projection = geoMercator()
            .rotate([-centerLng, 0])
            .scale(cam.scale)
            .translate([REEL.width / 2, REEL.height / 2 + cam.cy * cam.scale])
            .clipExtent([[-10, -10], [REEL.width + 10, REEL.height + 10]])
            .precision(cam.scale > 5000 ? 0.2 : 0.6);
        const path = geoPath(projection);
        return {
            grid: path(geoGraticule10()),
            land: world ? path(world.land) : null,
            borders: world ? path(world.borders) : null,
        };
    }, [cam.cx, cam.cy, cam.scale, world]);

    return (
        <>
            <svg width={REEL.width} height={REEL.height} style={{ position: 'absolute', inset: 0 }}>
                <Patterns />
                <rect width={REEL.width} height={REEL.height} fill={T.sea} />
                {T.seaPattern && <rect width={REEL.width} height={REEL.height} fill={`url(#tex-${T.seaPattern})`} />}
                {T.grid && paths.grid && <path d={paths.grid} fill="none" stroke={T.grid} strokeWidth={1.5} />}
                {paths.land && (
                    <>
                        <path d={paths.land} fill={T.land} stroke={T.landStroke || 'none'} strokeWidth={T.landStrokeWidth || 0} strokeLinejoin="round" />
                        {T.landPattern && <path d={paths.land} fill={`url(#tex-${T.landPattern})`} />}
                    </>
                )}
                {paths.borders && <path d={paths.borders} fill="none" stroke={T.border} strokeWidth={1.5} strokeDasharray={T.borderDash || undefined} />}
            </svg>
        </>
    );
};

// ---------------------------------------------------------------------------
// Stop names next to their markers. Labels try the right, left, top and bottom of
// their marker and are dropped when every spot would overlap another label or marker.

const LABEL_FONT = 30;
const LABEL_H = 48;
const labelText = (name) => (name.length > 24 ? `${name.slice(0, 23)}…` : name);
// Rough text width for the system font at this size (no DOM measuring inside the renderer)
const textWidth = (t) => [...t].reduce((w, ch) => w + (/[A-Z]/.test(ch) ? 0.68 : /[a-z0-9 ]/.test(ch) ? 0.55 : 0.75), 0) * LABEL_FONT;

function layoutLabels(markers, stops, reached, activeStop) {
    const boxes = markers.map(({ x, y }) => ({ x: x - 30, y: y - 30, w: 60, h: 60, marker: true }));
    const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    // Places in the frame's safe area (clear of the title and stats bands)
    const fits = (b) => b.x >= 16 && b.x + b.w <= REEL.width - 16 && b.y >= 250 && b.y + b.h <= REEL.height - 260;
    const order = [...markers].sort((a, b) => {
        const rank = (m) => (m.i === activeStop ? 0 : reached[m.i] ? 1 : 2);
        return rank(a) - rank(b) || b.i - a.i;
    });
    const out = [];
    order.forEach(({ i, x, y }) => {
        const text = labelText(stops[i].name || `Stop ${i + 1}`);
        const w = textWidth(text) + 36;
        const spots = [
            { x: x + 40, y: y - LABEL_H / 2 },
            { x: x - 40 - w, y: y - LABEL_H / 2 },
            { x: x - w / 2, y: y - 44 - LABEL_H },
            { x: x - w / 2, y: y + 44 },
        ];
        const pick = spots
            .map((p) => ({ ...p, w, h: LABEL_H }))
            .find((b) => fits(b) && !boxes.some((o) => (o.marker ? overlaps(b, o) : overlaps(b, { x: o.x - 8, y: o.y - 8, w: o.w + 16, h: o.h + 16 }))));
        if (!pick) return;
        boxes.push(pick);
        out.push({ ...pick, i, text, on: reached[i] });
    });
    return out;
}

// ---------------------------------------------------------------------------
// Route layer: finished legs, the leg in progress, stop markers and the vehicle.

const RouteLayer = ({ timeline, frame, cam }) => {
    const T = useReelTheme();
    const { segments, stops } = timeline;
    const idx = segmentAt(segments, frame);
    const current = segments[idx];
    const isOutro = current.type === 'outro';

    const legs = segments.filter((s) => s.type === 'leg');
    const drawn = [];
    legs.forEach((leg) => {
        let progress;
        if (isOutro || frame >= leg.start + leg.dur) progress = 1;
        else if (frame < leg.start) progress = 0;
        else progress = legProgress(leg, frame);
        if (progress <= 0) return;
        const pts = legPath(cam, leg, progress);
        // Where each photo on the way was taken, once the vehicle has reached it
        const spots = (leg.wayPhotos || [])
            .map((_, k) => wayPoint(leg, k))
            .filter((f) => progress >= f - 1e-6)
            .map((f) => legPath(cam, leg, f).at(-1));
        drawn.push({ leg, d: toPathD(pts), spots });
    });

    // A stop is "reached" once the vehicle gets there
    const reached = stops.map((_, i) => {
        if (i === 0) return frame >= (segments[1]?.start ?? 0);
        const leg = legs.find((l) => l.index === i);
        return isOutro || frame >= leg.start + leg.dur || (frame >= leg.start && legProgress(leg, frame) >= 0.97);
    });
    const activeStop = current.type === 'stop' ? current.index : null;

    const markers = stops
        .map((st, i) => { const [x, y] = project(cam, st.lng, st.lat); return { i, x, y }; })
        .filter(({ x, y }) => x > -60 && x < REEL.width + 60 && y > -60 && y < REEL.height + 60);
    // No names during the intro: the trip title has the screen to itself
    const labels = current.type === 'intro' ? [] : layoutLabels(markers, stops, reached, activeStop);

    return (
        <svg width={REEL.width} height={REEL.height} style={{ position: 'absolute', inset: 0 }}>
            {drawn.map(({ leg, d, spots }) => {
                const color = MODES[leg.mode].color;
                return (
                    <g key={leg.index}>
                        <path d={d} fill="none" stroke="#000" strokeOpacity={0.35} strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" />
                        {leg.mode === 'flight' && (
                            <path d={d} fill="none" stroke={color} strokeWidth={7} strokeLinecap="round" strokeLinejoin="round" />
                        )}
                        {leg.mode === 'train' && (
                            <>
                                {/* sleepers across the track, then the two rails */}
                                <path d={d} fill="none" stroke={color} strokeOpacity={0.55} strokeWidth={22} strokeDasharray="5 13" />
                                <path d={d} fill="none" stroke={color} strokeWidth={12} strokeLinecap="round" strokeLinejoin="round" />
                                <path d={d} fill="none" stroke="#0b1628" strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
                            </>
                        )}
                        {leg.mode === 'bus' && (
                            <>
                                {/* a purple road dotted with white "bus stops" */}
                                <path d={d} fill="none" stroke={color} strokeWidth={10} strokeLinecap="round" strokeLinejoin="round" />
                                <path d={d} fill="none" stroke="#ffffff" strokeWidth={5} strokeLinecap="round" strokeDasharray="0.1 26" />
                            </>
                        )}
                        {leg.mode === 'bike' && (
                            <>
                                <path d={d} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
                                <path d={d} fill="none" stroke="#f4f7fc" strokeOpacity={0.85} strokeWidth={2.5} strokeDasharray="12 14" />
                            </>
                        )}
                        {leg.mode === 'car' && (
                            <path d={d} fill="none" stroke={color} strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
                        )}
                        {spots.map(([sx, sy], k) => (
                            <g key={`spot-${k}`} transform={`translate(${sx.toFixed(1)} ${sy.toFixed(1)})`}>
                                <circle r={15} fill="#fbf4e4" stroke={color} strokeWidth={5} />
                                <circle r={5} fill="#0b1628" />
                            </g>
                        ))}
                    </g>
                );
            })}

            {labels.map((l) => (
                <g key={`label-${l.i}`} opacity={l.on ? 1 : 0.75}>
                    <rect x={l.x} y={l.y} width={l.w} height={LABEL_H} rx={LABEL_H / 2} fill={T.panel} stroke={l.on ? T.accent : T.markerOffStroke} strokeWidth={T.landStrokeWidth >= 3 ? 3.5 : 2.5} />
                    <text x={l.x + l.w / 2} y={l.y + LABEL_H / 2 + 10} textAnchor="middle" fontSize={LABEL_FONT} fontWeight={800} fontFamily={FONT} fill={l.on ? T.text : T.muted}>{l.text}</text>
                </g>
            ))}

            {markers.map(({ i, x, y }) => {
                const on = reached[i];
                const active = activeStop === i;
                const pulse = active ? 1 + 0.25 * Math.sin((frame - current.start) / 5) : 1;
                return (
                    <g key={i} transform={`translate(${x} ${y})`}>
                        {active && <circle r={44 * pulse} fill={C.gold} opacity={0.22} />}
                        <circle r={26} fill={on ? C.gold : T.markerOff} stroke={on ? (T.landStrokeWidth >= 3 ? '#000' : '#fff') : T.markerOffStroke} strokeWidth={4} />
                        <text y={10} textAnchor="middle" fontSize={28} fontWeight={800} fontFamily={FONT} fill={on ? '#0b1628' : T.markerOffText}>{i + 1}</text>
                    </g>
                );
            })}
        </svg>
    );
};

// ---- Vehicles ------------------------------------------------------------------
// A "lub-dub" heartbeat (about one beat a second) that makes the vehicle feel alive,
// with a ring rippling out on every beat.

const BEAT_FRAMES = 30;
const bump = (t, centre, width) => Math.exp(-(((t - centre) / width) ** 2));
const heartbeat = (frame) => {
    const t = (frame % BEAT_FRAMES) / BEAT_FRAMES;
    return {
        scale: 1 + 0.2 * (bump(t, 0.08, 0.05) + 0.65 * bump(t, 0.3, 0.05)),
        ripple: t, // 0..1 through the beat
    };
};

const Ripple = ({ beat, color, base = 62 }) => (
    <circle r={base + beat.ripple * 70} fill="none" stroke={color} strokeWidth={8 * (1 - beat.ripple)} opacity={0.7 * (1 - beat.ripple)} />
);

// Cartoon car seen from the side, facing right. Wheels spin, body bobs.
const CarArt = ({ frame }) => {
    const bob = Math.sin(frame * 0.9) * 1.6;
    const spin = (frame * 24) % 360;
    const wheel = (cx) => (
        <g transform={`translate(${cx} 16)`}>
            <circle r={11} fill="#1d2433" stroke="#0b1628" strokeWidth={3} />
            <circle r={4.5} fill="#cfd8e3" />
            <g transform={`rotate(${spin})`} stroke="#cfd8e3" strokeWidth={2.4} strokeLinecap="round">
                <line x1={-7} y1={0} x2={7} y2={0} />
                <line x1={0} y1={-7} x2={0} y2={7} />
            </g>
        </g>
    );
    return (
        <g>
            <ellipse cx={2} cy={29} rx={40} ry={5} fill="#000" opacity={0.25} />
            <g transform={`translate(0 ${bob.toFixed(2)})`}>
                <path d="M-42 8 Q-43 -5 -31 -7 L-19 -7 L-9 -23 Q-6 -27 -1 -27 L17 -27 Q23 -27 27 -21 L36 -7 Q45 -6 45 4 L45 12 Q45 17 40 17 L-37 17 Q-42 17 -42 12 Z"
                    fill={MODES.car.color} stroke="#0b1628" strokeWidth={3.5} strokeLinejoin="round" />
                <path d="M-5 -21 L1 -21 L1 -9 L-13 -9 Z" fill="#bfe6ff" stroke="#0b1628" strokeWidth={2.5} strokeLinejoin="round" />
                <path d="M5 -21 L16 -21 Q20 -21 23 -16 L27 -9 L5 -9 Z" fill="#bfe6ff" stroke="#0b1628" strokeWidth={2.5} strokeLinejoin="round" />
                <path d="M-36 -2 L30 -2" stroke="#fff" strokeOpacity={0.45} strokeWidth={3} strokeLinecap="round" />
                <circle cx={41} cy={2} r={4} fill={C.gold} stroke="#0b1628" strokeWidth={2} />
                <rect x={-43} y={4} width={7} height={5} rx={2} fill="#ffd2d8" />
            </g>
            {wheel(-22)}
            {wheel(25)}
        </g>
    );
};

// Cartoon streetfighter motorbike with a tucked-in rider, seen from the side, facing right:
// chunky orange tank, short sharp tail, exposed trellis frame, orange forks, split headlight,
// alloy wheels and speed lines.
const BIKE_ORANGE = '#ff7a1a';
const INK = '#0b1628';
const BLACK = '#141a24';
const BikeArt = ({ frame }) => {
    const lean = Math.sin(frame * 0.5) * 1.2; // a little throttle rock
    const bob = Math.sin(frame * 1.3) * 0.9;
    const spin = (frame * 32) % 360;
    const wheel = (cx) => (
        <g transform={`translate(${cx} 16)`}>
            <circle r={14} fill={BLACK} stroke={INK} strokeWidth={2.5} />
            <circle r={9} fill="none" stroke={BIKE_ORANGE} strokeWidth={2.5} />
            <g transform={`rotate(${spin})`} stroke={BIKE_ORANGE} strokeWidth={2.2} strokeLinecap="round">
                {[0, 72, 144, 216, 288].map((r) => <line key={r} x1={0} y1={0} x2={0} y2={-8.5} transform={`rotate(${r})`} />)}
            </g>
            <circle r={2.8} fill="#cfd8e3" />
        </g>
    );
    const streak = (y, len, phase) => {
        const t = (frame * 0.1 + phase) % 1;
        const x = -38 - t * 10;
        return <line key={phase} x1={x} y1={y} x2={x - len} y2={y} stroke="#fff" strokeWidth={3} strokeLinecap="round" opacity={0.85 * (1 - t)} />;
    };
    return (
        <g>
            {[streak(-18, 9, 0), streak(-6, 14, 0.35), streak(6, 8, 0.7)]}
            <ellipse cx={0} cy={31} rx={40} ry={4} fill="#000" opacity={0.25} />
            <g transform={`rotate(${lean.toFixed(2)} 0 16)`}>
                {/* swingarm, exhaust, forks */}
                <path d="M-27 16 L-6 7" stroke="#2b3240" strokeWidth={5} strokeLinecap="round" />
                <path d="M6 12 L-13 14" stroke="#8a95a8" strokeWidth={5.5} strokeLinecap="round" />
                <path d="M19 -15 L23 -1" stroke={BIKE_ORANGE} strokeWidth={5} strokeLinecap="round" />
                <path d="M23 -1 L27 16" stroke="#cfd8e3" strokeWidth={4} strokeLinecap="round" />
                {wheel(-27)}
                {wheel(27)}
                <path d="M18 3 Q27 -1 36 5" stroke={BIKE_ORANGE} strokeWidth={3} strokeLinecap="round" fill="none" />
                <g transform={`translate(0 ${bob.toFixed(2)})`}>
                    {/* engine block with fins, trellis frame */}
                    <path d="M-8 -3 L12 -3 L14 10 L-5 12 Z" fill="#3a4252" stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
                    <path d="M-4 2 L11 2 M-3 6 L12 6" stroke="#5b6576" strokeWidth={1.6} />
                    <polyline points="-21,-8 -15,1 -9,-7 -3,1 3,-5" fill="none" stroke={BIKE_ORANGE} strokeWidth={2.6} strokeLinejoin="round" strokeLinecap="round" />
                    {/* short, sharp upswept tail and the stepped seat */}
                    <path d="M-19 -12 L-35 -20 L-33 -15 L-22 -8 Z" fill={BIKE_ORANGE} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
                    <path d="M-7 -11 L-21 -13 L-23 -9 L-7 -7 Z" fill={BLACK} stroke={INK} strokeWidth={2} strokeLinejoin="round" />
                    {/* chunky tank with black shroud and a white flash */}
                    <path d="M-8 -10 L1 -18 L14 -19 L21 -9 L16 -2 L-6 -3 Z" fill={BIKE_ORANGE} stroke={INK} strokeWidth={3} strokeLinejoin="round" />
                    <path d="M9 -14 L19 -10 L15 -3 L7 -4 Z" fill={BLACK} />
                    <path d="M-3 -10 L8 -15" stroke="#fff" strokeWidth={2.5} strokeLinecap="round" />
                    {/* split headlight */}
                    <path d="M20 -20 L27 -18 L29 -7 L22 -6 Z" fill={BLACK} stroke={INK} strokeWidth={2.5} strokeLinejoin="round" />
                    <path d="M23.5 -16 L26.5 -15 L27 -12.5 L24 -13 Z" fill="#fff8d6" />
                    <path d="M24.5 -10.5 L27.5 -10 L28 -8 L25 -8 Z" fill="#fff8d6" />
                    {/* rider tucked forward: leg, jacket with stripe, arm, helmet with stripe and visor */}
                    <path d="M-13 -14 L1 -11 L-5 1" stroke="#2b3240" strokeWidth={5.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    <path d="M-14 -14 L5 -28" stroke={BLACK} strokeWidth={12} strokeLinecap="round" />
                    <path d="M-11 -19.5 L4 -30" stroke={BIKE_ORANGE} strokeWidth={2.4} strokeLinecap="round" />
                    <path d="M5 -27 L11 -21 L18 -21" stroke={BLACK} strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" fill="none" />
                    <circle cx={12} cy={-32} r={8.5} fill={BLACK} stroke={INK} strokeWidth={2.5} />
                    <path d="M5 -37 Q12 -42 19 -35" stroke={BIKE_ORANGE} strokeWidth={2.8} strokeLinecap="round" fill="none" />
                    <path d="M14 -34 Q21 -34 20.5 -28.5 L14 -28.5 Z" fill="#5aa9e6" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" />
                </g>
            </g>
        </g>
    );
};

// Cartoon bus seen from the side, facing right: windows, door, destination sign,
// a roof unit, a headlight and spinning wheels.
const BusArt = ({ frame }) => {
    const bob = Math.sin(frame * 0.8) * 1.2;
    const spin = (frame * 22) % 360;
    const color = MODES.bus.color;
    const wheel = (cx) => (
        <g transform={`translate(${cx} 18)`}>
            <circle r={10.5} fill="#1d2433" stroke="#0b1628" strokeWidth={3} />
            <circle r={4.5} fill="#cfd8e3" />
            <g transform={`rotate(${spin})`} stroke="#cfd8e3" strokeWidth={2.2} strokeLinecap="round">
                <line x1={-6.5} y1={0} x2={6.5} y2={0} />
                <line x1={0} y1={-6.5} x2={0} y2={6.5} />
            </g>
        </g>
    );
    return (
        <g>
            <ellipse cx={0} cy={30} rx={44} ry={4.5} fill="#000" opacity={0.25} />
            <g transform={`translate(0 ${bob.toFixed(2)})`}>
                {/* roof unit, body, windscreen */}
                <rect x={-26} y={-32} width={34} height={7} rx={3} fill="#6d45c9" stroke="#0b1628" strokeWidth={2.5} />
                <path d="M-44 -18 Q-44 -26 -36 -26 L32 -26 Q40 -26 42 -18 L46 6 Q46 16 38 16 L-38 16 Q-44 16 -44 10 Z"
                    fill={color} stroke="#0b1628" strokeWidth={3.5} strokeLinejoin="round" />
                <path d="M33 -21 L39 -21 L43 -2 L33 -2 Z" fill="#bfe6ff" stroke="#0b1628" strokeWidth={2.5} strokeLinejoin="round" />
                {/* passenger windows */}
                {[-38, -24, -10].map((x) => (
                    <rect key={x} x={x} y={-20} width={11} height={14} rx={3} fill="#bfe6ff" stroke="#0b1628" strokeWidth={2.2} />
                ))}
                {/* door */}
                <rect x={6} y={-20} width={13} height={33} rx={3} fill="#bfe6ff" stroke="#0b1628" strokeWidth={2.2} />
                <line x1={12.5} y1={-19} x2={12.5} y2={12} stroke="#0b1628" strokeWidth={1.8} />
                {/* white stripe, destination sign, headlight, tail light */}
                <path d="M-42 2 L4 2 M21 2 L44 2" stroke="#fff" strokeOpacity={0.7} strokeWidth={3} strokeLinecap="round" />
                <rect x={22} y={-21} width={9} height={5} rx={1.5} fill={C.gold} stroke="#0b1628" strokeWidth={1.5} />
                <circle cx={42} cy={9} r={3.5} fill={C.gold} stroke="#0b1628" strokeWidth={1.8} />
                <rect x={-45} y={4} width={4} height={6} rx={1.5} fill="#ff6b6b" />
            </g>
            {wheel(-26)}
            {wheel(28)}
        </g>
    );
};

// Cartoon plane seen from above, nose pointing right.
const PlaneArt = () => (
    <g>
        <path d="M2 -8 L-14 -46 Q-16 -50 -11 -50 L-5 -50 L24 -8 Z" fill={C.gold} stroke="#0b1628" strokeWidth={3} strokeLinejoin="round" />
        <path d="M2 8 L-14 46 Q-16 50 -11 50 L-5 50 L24 8 Z" fill={C.gold} stroke="#0b1628" strokeWidth={3} strokeLinejoin="round" />
        <path d="M-30 -5 L-42 -21 L-35 -22 L-20 -5 Z" fill={C.gold} stroke="#0b1628" strokeWidth={2.5} strokeLinejoin="round" />
        <path d="M-30 5 L-42 21 L-35 22 L-20 5 Z" fill={C.gold} stroke="#0b1628" strokeWidth={2.5} strokeLinejoin="round" />
        <path d="M-42 0 Q-42 -9 -30 -10 L28 -10 Q46 -9 48 0 Q46 9 28 10 L-30 10 Q-42 9 -42 0 Z" fill="#f4f7fc" stroke="#0b1628" strokeWidth={3.5} />
        {[-20, -11, -2, 7, 16].map((wx) => <circle key={wx} cx={wx} cy={0} r={2.6} fill="#5aa9e6" />)}
        <path d="M32 -6 Q42 -4 43 0 Q42 4 32 6 Z" fill="#5aa9e6" stroke="#0b1628" strokeWidth={2} />
    </g>
);

const Badge = ({ x, y, color, beat, appear, children }) => (
    <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`} opacity={appear}>
        <Ripple beat={beat} color={color} />
        <g transform={`scale(${(beat.scale * (0.6 + 0.4 * appear)).toFixed(3)})`}>
            <circle cy={6} r={60} fill="#000" opacity={0.3} />
            <circle r={60} fill={color} stroke="#fff" strokeWidth={6} />
            <circle r={48} fill="#fff" opacity={0.22} />
            {children}
        </g>
    </g>
);

// A cartoon train (engine plus three colourful carriages) that follows the curve of the track.
const TRAIN_PARTS = [{ len: 112, engine: true }, { len: 90, roof: C.gold }, { len: 90, roof: MODES.car.color }, { len: 90, roof: '#4cc38a' }];
const TrainSprite = ({ pts, frame, appear }) => {
    const items = [];
    let back = 0;
    TRAIN_PARTS.forEach((part) => {
        items.push({ ...part, ...pointBack(pts, back + part.len / 2) });
        back += part.len + 12;
    });
    const engine = items[0];
    const rad = (engine.angle * Math.PI) / 180;
    const beat = heartbeat(frame);
    return (
        <svg width={REEL.width} height={REEL.height} style={{ position: 'absolute', inset: 0, opacity: appear }}>
            <g transform={`translate(${engine.x.toFixed(1)} ${engine.y.toFixed(1)})`}>
                <Ripple beat={beat} color={MODES.train.color} base={66} />
            </g>
            {[0, 1, 2].map((k) => {
                // Smoke puffs from the chimney, drifting up and fading
                const phase = ((frame * 0.9 + k * 13) % 39) / 39;
                const x = engine.x - Math.cos(rad) * 40 + phase * 16;
                const y = engine.y - Math.sin(rad) * 40 - 10 - phase * 80;
                return <circle key={k} cx={x} cy={y} r={12 + phase * 18} fill="#f4f7fc" stroke="#cfd8e3" strokeWidth={2} opacity={(1 - phase) * 0.8} />;
            })}
            {items.slice(1).reverse().map((it, i) => (
                <g key={i} transform={`translate(${it.x.toFixed(1)} ${it.y.toFixed(1)}) rotate(${it.angle.toFixed(1)})`}>
                    <rect x={-45} y={-23} width={90} height={46} rx={13} fill="#f4f7fc" stroke="#0b1628" strokeWidth={4.5} />
                    <rect x={-37} y={-14} width={74} height={28} rx={9} fill={it.roof} />
                    {[-24, -8, 8, 24].map((wx) => <circle key={wx} cx={wx} cy={0} r={4} fill="#fff" />)}
                </g>
            ))}
            <g transform={`translate(${engine.x.toFixed(1)} ${engine.y.toFixed(1)}) rotate(${engine.angle.toFixed(1)}) scale(${beat.scale.toFixed(3)})`}>
                <path d="M56 -26 L70 0 L56 26 Z" fill={C.gold} stroke="#0b1628" strokeWidth={4} strokeLinejoin="round" />
                <rect x={-56} y={-28} width={116} height={56} rx={20} fill={MODES.train.color} stroke="#0b1628" strokeWidth={5} />
                <rect x={-50} y={-20} width={34} height={40} rx={9} fill="#2a5d8f" stroke="#0b1628" strokeWidth={3} />
                <rect x={-44} y={-12} width={22} height={24} rx={5} fill="#bfe6ff" />
                <circle cx={14} cy={0} r={13} fill="#1d2433" stroke="#0b1628" strokeWidth={3} />
                <circle cx={14} cy={0} r={6} fill="#4b5568" />
                <circle cx={46} cy={0} r={9} fill={C.gold} stroke="#0b1628" strokeWidth={3} />
                <circle cx={46} cy={0} r={4} fill="#fff" />
                <path d="M-8 -22 L36 -22" stroke="#fff" strokeOpacity={0.5} strokeWidth={4} strokeLinecap="round" />
            </g>
        </svg>
    );
};

const Vehicle = ({ timeline, frame, cam }) => {
    const seg = timeline.segments[segmentAt(timeline.segments, frame)];
    if (seg.type !== 'leg') return null;
    const p = legProgress(seg, frame);
    const pts = legPath(cam, seg, Math.max(p, 0.001));
    const appear = clamp01((frame - seg.start - 4) / 8);
    if (seg.mode === 'train') return <TrainSprite pts={pts} frame={frame} appear={appear} />;

    const [x, y] = pts[pts.length - 1];
    const heading = headingDeg(pts);
    const beat = heartbeat(frame);
    // The plane points along its arc and banks gently; road vehicles stay upright and face their direction
    const art = seg.mode === 'flight'
        ? <g transform={`rotate(${(heading + Math.sin(frame * 0.15) * 4).toFixed(1)}) scale(0.95)`}><PlaneArt /></g>
        : <g transform={`scale(${Math.abs(heading) > 90 ? -1 : 1} 1)`}>{seg.mode === 'bike' ? <BikeArt frame={frame} /> : seg.mode === 'bus' ? <BusArt frame={frame} /> : <CarArt frame={frame} />}</g>;
    return (
        <svg width={REEL.width} height={REEL.height} style={{ position: 'absolute', inset: 0 }}>
            <Badge x={x} y={y} color={seg.mode === 'flight' ? '#2a5d8f' : '#fff4e0'} beat={beat} appear={appear}>
                {art}
            </Badge>
        </svg>
    );
};

// ---------------------------------------------------------------------------
// Text and photo overlays.

// Panels over the map take the theme's colours, border and shadow
const panelStyle = (T) => ({ background: T.panel, border: T.panelBorder, boxShadow: T.panelShadow });
// Text drawn straight on the map gets a soft shadow on photographic and dark maps
const onMapShadow = (T) => (T.text === '#f4f7fc' ? '0 2px 10px rgba(0, 0, 0, 0.65)' : 'none');

const TopBand = ({ title, timeline, frame }) => {
    const T = useReelTheme();
    const { segments, stops } = timeline;
    const seg = segments[segmentAt(segments, frame)];
    if (seg.type === 'intro') return null;
    const reachedCount = seg.type === 'outro' ? stops.length
        : seg.type === 'stop' ? seg.index + 1 : seg.index;
    return (
        <div style={{ position: 'absolute', top: 70, left: 60, right: 60, fontFamily: FONT }}>
            <div style={{ color: T.text, opacity: 0.8, fontSize: 30, fontWeight: 700, letterSpacing: 6, textTransform: 'uppercase', textShadow: onMapShadow(T) }}>{title}</div>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                {stops.map((_, i) => (
                    <div key={i} style={{ flex: 1, height: 10, borderRadius: 5, background: i < reachedCount ? T.accent : T.barOff }} />
                ))}
            </div>
        </div>
    );
};

const PlaceTitle = ({ stop, number, appear }) => {
    const T = useReelTheme();
    return (
    <div style={{
        position: 'absolute', top: 190, left: 60, right: 60, fontFamily: FONT,
        opacity: appear, transform: `translateY(${(1 - appear) * 30}px)`,
    }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 14, ...panelStyle(T), borderRadius: 28, padding: '22px 34px' }}>
            <MapPin size={52} color={T.accent} strokeWidth={2.6} />
            <div>
                <div style={{ color: T.muted, fontSize: 28, fontWeight: 700, letterSpacing: 3 }}>STOP {number}</div>
                <div style={{ color: T.text, fontSize: T.titleFont ? 70 : 64, fontWeight: 800, lineHeight: 1.05, fontFamily: T.titleFont || FONT, letterSpacing: T.titleSpacing || 0 }}>{stop.name}</div>
            </div>
        </div>
    </div>
    );
};

const PhotoCard = ({ src, local, index, total }) => {
    // local: frames since this photo started
    const { fps } = useVideoConfig();
    const enter = spring({ frame: local, fps, config: { damping: 14, mass: 0.8 } });
    const tilt = index % 2 === 0 ? -3 : 3;
    const zoom = interpolate(local, [0, TIMING.perPhoto * 2], [1, 1.12], { extrapolateRight: 'clamp' });
    return (
        <div style={{
            position: 'absolute', left: 130, top: 760, width: 820, padding: 22, paddingBottom: 26,
            background: '#fbf4e4', borderRadius: 18, boxShadow: '0 30px 60px rgba(0,0,0,0.5)',
            transform: `translateY(${(1 - enter) * 700}px) rotate(${tilt * enter}deg)`,
        }}>
            <div style={{ width: 776, height: 800, overflow: 'hidden', borderRadius: 8, background: '#ddd' }}>
                <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})` }} />
            </div>
            <div style={{ marginTop: 14, color: '#2b1d14', fontFamily: FONT, fontSize: 28, fontWeight: 700, textAlign: 'right' }}>
                {index + 1} / {total}
            </div>
        </div>
    );
};

// A photo taken on the way: a smaller polaroid that pops up while the vehicle pauses.
const WayPhotoCard = ({ src, local, index, total, color, top }) => {
    const { fps } = useVideoConfig();
    const enter = spring({ frame: local, fps, config: { damping: 13, mass: 0.7 } });
    const leave = clamp01((local - (TIMING.wayPhoto - 10)) / 10);
    const tilt = index % 2 === 0 ? 3 : -3;
    const zoom = interpolate(local, [0, TIMING.wayPhoto], [1, 1.08], { extrapolateRight: 'clamp' });
    return (
        <div style={{
            position: 'absolute', left: 190, top, width: 700, padding: 20, paddingBottom: 22,
            background: '#fbf4e4', borderRadius: 18, boxShadow: '0 30px 60px rgba(0,0,0,0.5)', opacity: 1 - leave,
            transform: `translateY(${(1 - enter) * 600 + leave * 60}px) scale(${0.85 + 0.15 * enter}) rotate(${tilt * enter}deg)`,
        }}>
            <div style={{ width: 660, height: 560, overflow: 'hidden', borderRadius: 8, background: '#ddd' }}>
                <Img src={src} style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${zoom})` }} />
            </div>
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontFamily: FONT, color: '#2b1d14' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 28, fontWeight: 800 }}>
                    <Camera size={30} color={color} strokeWidth={2.6} /> On the way
                </div>
                {total > 1 && <div style={{ fontSize: 26, fontWeight: 700 }}>{index + 1} / {total}</div>}
            </div>
        </div>
    );
};

const StatsBand = ({ timeline, frame }) => {
    const T = useReelTheme();
    const { segments } = timeline;
    const seg = segments[segmentAt(segments, frame)];
    if (seg.type === 'intro' || seg.type === 'outro') return null;
    let km = seg.kmBefore;
    let mode = null;
    if (seg.type === 'leg') {
        km += seg.km * legProgress(seg, frame);
        mode = seg.mode;
    }
    const Icon = mode ? ICONS[mode] : null;
    return (
        <div style={{
            position: 'absolute', left: 60, right: 60, bottom: 90, display: 'flex', alignItems: 'center',
            justifyContent: 'space-between', fontFamily: FONT,
        }}>
            <div style={{ ...panelStyle(T), borderRadius: 26, padding: '20px 30px' }}>
                <div style={{ color: T.muted, fontSize: 26, fontWeight: 700, letterSpacing: 3 }}>TRAVELLED</div>
                <div style={{ color: T.text, fontSize: 60, fontWeight: 800 }}>{fmtKm(km)}</div>
            </div>
            {Icon && (
                <div style={{ ...panelStyle(T), borderRadius: 26, padding: '20px 30px', display: 'flex', alignItems: 'center', gap: 16 }}>
                    <Icon size={48} color={MODES[mode].color} strokeWidth={2.4} />
                    <div style={{ color: T.text, fontSize: 40, fontWeight: 700 }}>{MODES[mode].label}</div>
                </div>
            )}
        </div>
    );
};

const Intro = ({ title, timeline, frame }) => {
    const T = useReelTheme();
    const seg = timeline.segments[0];
    if (frame >= seg.dur + 10) return null;
    const inT = clamp01(frame / 18);
    const outT = clamp01((frame - (seg.dur - 12)) / 18);
    const o = inT * (1 - outT);
    return (
        <AbsoluteFill style={{ background: T.veil, opacity: o, justifyContent: 'center', alignItems: 'center', fontFamily: FONT }}>
            <div style={{ transform: `translateY(${(1 - inT) * 40}px)`, textAlign: 'center', padding: '0 70px' }}>
                <div style={{ color: T.accent, fontSize: 34, fontWeight: 800, letterSpacing: 8 }}>MY TRIP</div>
                <div style={{ color: T.text, fontSize: T.titleFont ? 122 : 108, fontWeight: 900, lineHeight: 1.02, marginTop: 18, fontFamily: T.titleFont || FONT, letterSpacing: T.titleSpacing || 0 }}>{title}</div>
                <div style={{ color: T.muted, fontSize: 40, fontWeight: 600, marginTop: 26 }}>
                    {timeline.totals.places} places · {fmtKm(timeline.totals.km)}
                </div>
            </div>
        </AbsoluteFill>
    );
};

const Outro = ({ title, timeline, frame }) => {
    const T = useReelTheme();
    const { fps } = useVideoConfig();
    const seg = timeline.segments[timeline.segments.length - 1];
    if (frame < seg.start) return null;
    const local = frame - seg.start;
    const enter = spring({ frame: local - 18, fps, config: { damping: 16 } });
    const rows = Object.entries(timeline.totals.byMode).filter(([, km]) => km > 0);
    return (
        <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', fontFamily: FONT, paddingBottom: 150 }}>
            <div style={{
                width: 900, ...panelStyle(T), borderRadius: 36, padding: '44px 54px',
                opacity: clamp01(enter), transform: `translateY(${(1 - enter) * 120}px)`,
            }}>
                <div style={{ color: T.accent, fontSize: 30, fontWeight: 800, letterSpacing: 6 }}>THAT'S A WRAP</div>
                <div style={{ color: T.text, fontSize: T.titleFont ? 74 : 66, fontWeight: 900, marginTop: 8, lineHeight: 1.05, fontFamily: T.titleFont || FONT, letterSpacing: T.titleSpacing || 0 }}>{title}</div>
                <div style={{ display: 'flex', gap: 60, marginTop: 30 }}>
                    <div>
                        <div style={{ color: T.text, fontSize: 64, fontWeight: 800 }}>{timeline.totals.places}</div>
                        <div style={{ color: T.muted, fontSize: 28, fontWeight: 600 }}>places</div>
                    </div>
                    <div>
                        <div style={{ color: T.text, fontSize: 64, fontWeight: 800 }}>{fmtKm(timeline.totals.km)}</div>
                        <div style={{ color: T.muted, fontSize: 28, fontWeight: 600 }}>travelled</div>
                    </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, marginTop: 30 }}>
                    {rows.map(([mode, km]) => {
                        const Icon = ICONS[mode];
                        return (
                            <div key={mode} style={{ display: 'flex', alignItems: 'center', gap: 12, background: T.chip, borderRadius: 20, padding: '12px 20px' }}>
                                <Icon size={36} color={MODES[mode].color} strokeWidth={2.4} />
                                <span style={{ color: T.text, fontSize: 30, fontWeight: 700 }}>{fmtKm(km)}</span>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div style={{ color: T.text, fontSize: 30, fontWeight: 800, letterSpacing: 4, marginTop: 30, opacity: 0.75 * clamp01(enter), textShadow: onMapShadow(T) }}>Travelator by Adarsh</div>
        </AbsoluteFill>
    );
};

// ---------------------------------------------------------------------------

export const TravelReel = ({ title = 'My trip', stops = [], theme }) => {
    const T = themeFor(theme);
    const frame = useCurrentFrame();
    const timeline = useMemo(() => buildTimeline(stops), [stops]);
    const cam = cameraAt(timeline.segments, frame);
    const seg = timeline.segments[segmentAt(timeline.segments, frame)];

    let stopOverlay = null;
    if (seg.type === 'stop') {
        const stop = timeline.stops[seg.index];
        const local = frame - seg.start;
        const appear = clamp01(local / 12) * (1 - clamp01((local - (seg.dur - 10)) / 10));
        const photoIndex = Math.floor((local - TIMING.stopBase * 0.4) / TIMING.perPhoto);
        stopOverlay = (
            <>
                <PlaceTitle stop={stop} number={seg.index + 1} appear={appear} />
                {seg.photos.map((src, k) => {
                    if (k > photoIndex || k < photoIndex - 1) return null;
                    const startAt = TIMING.stopBase * 0.4 + k * TIMING.perPhoto;
                    return <PhotoCard key={k} src={src} local={local - startAt} index={k} total={seg.photos.length} />;
                })}
            </>
        );
    }

    const way = wayPhotoAt(seg, frame);
    // Keep the card clear of the paused vehicle: below it, or above it when it's low on screen
    const vehicleY = way ? legPath(cam, seg, legProgress(seg, frame)).at(-1)[1] : 0;
    const wayOverlay = way && (
        <WayPhotoCard
            src={seg.wayPhotos[way.index]} local={way.local} index={way.index} total={seg.wayPhotos.length}
            color={MODES[seg.mode].color} top={vehicleY > 860 ? 270 : 880}
        />
    );

    return (
        <ReelTheme.Provider value={T}>
        <AbsoluteFill style={{ background: T.sea, overflow: 'hidden' }}>
            <MapLayer cam={cam} />
            <RouteLayer timeline={timeline} frame={frame} cam={cam} />
            <Vehicle timeline={timeline} frame={frame} cam={cam} />
            <TopBand title={title} timeline={timeline} frame={frame} />
            {stopOverlay}
            {wayOverlay}
            <StatsBand timeline={timeline} frame={frame} />
            <Intro title={title} timeline={timeline} frame={frame} />
            <Outro title={title} timeline={timeline} frame={frame} />
        </AbsoluteFill>
        </ReelTheme.Provider>
    );
};
