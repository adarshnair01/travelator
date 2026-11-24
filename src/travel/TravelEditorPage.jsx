import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Player } from '@remotion/player';
import {
    Plane, TrainFront, Car, Motorbike, Bus, Search, Trash2, ArrowUp, ArrowDown, ImagePlus, X, Film,
    Download, ArrowLeft, Loader2, MapPin, Pencil, Landmark, Camera, Images,
} from 'lucide-react';
import { searchPlaces, reverseLookup, suggestPlaces } from './geocode';
import { getRoute, routeKey, ROAD_MODES } from './routes';
import { readPhotoInfo, groupIntoStops, placeByTime, guessMode } from './photoTrip';
import { TravelReel } from './TravelReel';
import { REEL, MODES, TIMING, buildTimeline, distanceKm, curvePoints, legSeed } from './geo';
import { loadWorld } from './world';
import { THEMES, DEFAULT_THEME } from './themes';

const MODE_ICONS = { flight: Plane, train: TrainFront, car: Car, bike: Motorbike, bus: Bus };
const MAX_STOPS = 20;
const MAX_PHOTOS = 4;
const DRAFT_KEY = 'travel-reel-draft-v1';
const THEME_KEY = 'travel-reel-theme';

const loadThemeKey = () => {
    try {
        const k = localStorage.getItem(THEME_KEY);
        return THEMES[k] ? k : DEFAULT_THEME;
    } catch {
        return DEFAULT_THEME;
    }
};
let nextId = 1;
const newId = () => `${Date.now().toString(36)}-${nextId++}`;

// ---- Drafts: stops and title are kept in this browser; photos are not ----------

function loadDraft() {
    try {
        const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
        if (d && Array.isArray(d.stops)) {
            return {
                title: d.title || 'My trip',
                stops: d.stops.map((s) => ({ ...s, id: newId(), photos: [], wayPhotos: [] })),
                routes: d.routes && typeof d.routes === 'object' ? d.routes : {},
            };
        }
    } catch {
        // ignore a broken or blocked draft
    }
    return { title: 'My trip', stops: [], routes: {} };
}

// The route key of each leg over land (car, bike, bus and train), indexed by the stop it arrives at.
const legKeys = (stops) => stops.map((s, i) => (i > 0 && ROAD_MODES.has(s.mode) ? routeKey(stops[i - 1], s, s.mode) : null));

function saveDraft(title, stops, routes) {
    const keep = {};
    legKeys(stops).forEach((k) => { if (k && routes[k]) keep[k] = routes[k]; });
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
            title,
            stops: stops.map(({ name, lat, lng, mode }) => ({ name, lat, lng, mode })),
            routes: keep,
        }));
    } catch {
        // storage full or blocked: the editor still works
    }
}

// Shrink photos to at most 1600 px so previews and exports stay fast.
async function preparePhoto(file) {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    return { id: newId(), url: URL.createObjectURL(blob) };
}

// ---- Map -------------------------------------------------------------------

const markerIcon = (n, active) => L.divIcon({
    className: '',
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    html: `<div style="width:34px;height:34px;border-radius:17px;background:${active ? '#f0c34e' : '#16233f'};color:${active ? '#0a1324' : '#f4f7fc'};border:3px solid #f4f7fc;display:flex;align-items:center;justify-content:center;font:700 14px system-ui;box-shadow:0 4px 12px rgba(0,0,0,.4)">${n}</div>`,
});

const ClickToAdd = ({ onPick, disabled }) => {
    useMapEvents({
        click(e) {
            if (!disabled) onPick(e.latlng.lat, e.latlng.lng);
        },
    });
    return null;
};

const FitToStops = ({ stops, focus }) => {
    const map = useMap();
    const count = stops.length;
    useEffect(() => {
        // Show the whole route once there are two places; zoom to the first place on its own
        if (count > 1) {
            map.flyToBounds(stops.map((s) => [s.lat, s.lng]), { padding: [60, 60], maxZoom: 9, duration: 0.8 });
        } else if (focus) {
            map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 6), { duration: 0.8 });
        }
        // Only re-frame when a stop is added or removed, not on every rename
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [count, focus]);
    return null;
};

const TripMap = ({ stops, routes, onPick, adding, focus }) => (
    <MapContainer center={[20, 78]} zoom={4} worldCopyJump className="h-full w-full" style={{ background: '#0a1324' }}>
        <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={18}
        />
        <ClickToAdd onPick={onPick} disabled={adding || stops.length >= MAX_STOPS} />
        <FitToStops stops={stops} focus={focus} />
        {stops.slice(1).map((s, i) => {
            // The leg's land-following route once found; until then (and for flights) the drawn curve
            const prev = stops[i];
            const route = s.mode !== 'flight' && routes[routeKey(prev, s, s.mode)];
            const positions = (route || curvePoints([prev.lng, prev.lat], [s.lng, s.lat], s.mode, legSeed(prev, s), { samples: 80, upIsNegativeY: false }))
                .map(([lng, lat]) => [lat, lng]);
            const color = MODES[s.mode]?.color || '#fff';
            return (
                <Fragment key={s.id}>
                    <Polyline positions={positions} pathOptions={{ color, weight: s.mode === 'train' ? 7 : 4 }} />
                    {s.mode === 'train' && <Polyline positions={positions} pathOptions={{ color: '#0b1628', weight: 2 }} />}
                    {s.mode === 'bus' && <Polyline positions={positions} pathOptions={{ color: '#f4f7fc', weight: 3, dashArray: '1 14', lineCap: 'round' }} />}
                    {s.mode === 'bike' && <Polyline positions={positions} pathOptions={{ color: '#f4f7fc', weight: 1.5, dashArray: '6 8' }} />}
                </Fragment>
            );
        })}
        {stops.map((s, i) => (
            <Marker key={s.id} position={[s.lat, s.lng]} icon={markerIcon(i + 1, i === stops.length - 1)} title={s.name}>
                <Tooltip permanent direction="right" offset={[18, 0]} className="stop-label">{s.name}</Tooltip>
            </Marker>
        ))}
    </MapContainer>
);

// ---- Small controls ----------------------------------------------------------

const ModePicker = ({ value, onChange, label }) => (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
        {Object.entries(MODES).map(([key, m]) => {
            const Icon = MODE_ICONS[key];
            const on = value === key;
            return (
                <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => onChange(key)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold border transition-colors ${on ? 'text-night' : 'text-snow/80 border-frost/20 hover:border-frost/50'}`}
                    style={on ? { background: m.color, borderColor: m.color } : undefined}
                >
                    <Icon size={14} aria-hidden="true" /> {m.label}
                </button>
            );
        })}
    </div>
);

// Thumbnail with a remove button, used for stop photos and photos on the way.
const Thumb = ({ url, onRemove, small }) => (
    <div className={`group relative overflow-hidden rounded-lg ${small ? 'h-11 w-11' : 'h-14 w-14'}`}>
        <img src={url} alt="" className="h-full w-full object-cover" />
        <button type="button" onClick={onRemove} className="absolute right-0.5 top-0.5 rounded-full bg-night/80 p-0.5 text-snow" aria-label="Remove photo">
            <X size={12} />
        </button>
    </div>
);

const StopCard = ({ stop, index, total, onChange, onRemove, onMove, onAddPhotos, onRemovePhoto, onAddWayPhotos, onRemoveWayPhoto, prev }) => {
    const fileRef = useRef(null);
    const wayRef = useRef(null);
    const wayPhotos = stop.wayPhotos || [];
    const km = prev ? distanceKm(prev, stop) : 0;
    return (
        <li className="rounded-2xl border border-frost/15 bg-night-card p-3">
            {index > 0 && (
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-frost/10 pb-3">
                    <span className="text-xs text-text-muted">From stop {index} · {Math.round(km).toLocaleString('en-IN')} km by</span>
                    <ModePicker value={stop.mode} onChange={(mode) => onChange({ mode })} label={`How you travelled to stop ${index + 1}`} />
                    <div className="flex w-full flex-wrap items-center gap-2">
                        {wayPhotos.map((p) => <Thumb key={p.id} url={p.url} small onRemove={() => onRemoveWayPhoto(p.id)} />)}
                        {wayPhotos.length < TIMING.maxWayPhotos && (
                            <button
                                type="button"
                                onClick={() => wayRef.current?.click()}
                                className="flex items-center gap-1.5 rounded-full border border-dashed border-frost/30 px-3 py-1.5 text-xs text-text-muted hover:border-gold hover:text-gold"
                            >
                                <Camera size={14} aria-hidden="true" /> {wayPhotos.length ? 'Add another' : 'Photo on the way'}
                                {!wayPhotos.length && <span className="text-text-muted/70">(optional)</span>}
                            </button>
                        )}
                        <input
                            ref={wayRef}
                            type="file"
                            accept="image/*"
                            multiple
                            hidden
                            aria-label={`Photos taken on the way to stop ${index + 1}`}
                            onChange={(e) => { onAddWayPhotos([...e.target.files]); e.target.value = ''; }}
                        />
                    </div>
                </div>
            )}
            <div className="flex items-start gap-3">
                <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gold text-sm font-extrabold text-night">{index + 1}</span>
                <div className="min-w-0 flex-1">
                    <label className="sr-only" htmlFor={`name-${stop.id}`}>Name of stop {index + 1}</label>
                    <div className="flex items-center gap-1.5">
                        <input
                            id={`name-${stop.id}`}
                            value={stop.name}
                            onChange={(e) => onChange({ name: e.target.value })}
                            className="w-full rounded-lg bg-transparent px-1 py-0.5 font-bold text-snow outline-none focus:bg-night"
                        />
                        <Pencil size={12} className="shrink-0 text-text-muted" aria-hidden="true" />
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                        {stop.photos.map((p) => <Thumb key={p.id} url={p.url} onRemove={() => onRemovePhoto(p.id)} />)}
                        {stop.photos.length < MAX_PHOTOS && (
                            <button
                                type="button"
                                onClick={() => fileRef.current?.click()}
                                className="flex h-14 w-14 flex-col items-center justify-center rounded-lg border border-dashed border-frost/30 text-[10px] text-text-muted hover:border-gold hover:text-gold"
                            >
                                <ImagePlus size={18} aria-hidden="true" /> Photo
                            </button>
                        )}
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            multiple
                            hidden
                            onChange={(e) => { onAddPhotos([...e.target.files]); e.target.value = ''; }}
                        />
                    </div>
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                    <button type="button" onClick={() => onMove(-1)} disabled={index === 0} className="rounded p-1 text-text-muted hover:text-snow disabled:opacity-30" aria-label={`Move stop ${index + 1} up`}><ArrowUp size={16} /></button>
                    <button type="button" onClick={() => onMove(1)} disabled={index === total - 1} className="rounded p-1 text-text-muted hover:text-snow disabled:opacity-30" aria-label={`Move stop ${index + 1} down`}><ArrowDown size={16} /></button>
                    <button type="button" onClick={onRemove} className="rounded p-1 text-text-muted hover:text-holly" aria-label={`Remove stop ${index + 1}`}><Trash2 size={16} /></button>
                </div>
            </div>
        </li>
    );
};

// ---- Reel preview and export ------------------------------------------------

async function pickFormat(renderer) {
    try {
        const mp4 = await renderer.getEncodableVideoCodecs('mp4');
        if (mp4.includes('h264')) return { container: 'mp4', videoCodec: 'h264', ext: 'mp4' };
    } catch {
        // fall through
    }
    const webm = await renderer.getEncodableVideoCodecs('webm');
    const codec = ['vp9', 'vp8', 'av1'].find((c) => webm.includes(c));
    if (!codec) throw new Error('This browser cannot encode video. Try a recent Chrome, Edge or Safari.');
    return { container: 'webm', videoCodec: codec, ext: 'webm' };
}

// A small preview of each map style: its sea, land and route colours
const ThemeSwatch = ({ t }) => (
    <svg viewBox="0 0 64 40" className="h-10 w-16 rounded-lg" aria-hidden="true">
        <rect width="64" height="40" fill={t.sea} />
        <path d="M0 26 C14 18 22 30 34 20 S54 10 64 14 V40 H0 Z" fill={t.land} stroke={t.landStroke || 'none'} strokeWidth={t.landStroke ? 1.5 : 0} />
        <path d="M8 32 C20 24 34 30 52 12" fill="none" stroke="#ef5b6f" strokeWidth="3" strokeLinecap="round" />
        <circle cx="52" cy="12" r="4" fill="#f0c34e" stroke={t.landStrokeWidth >= 3 ? '#000' : '#fff'} strokeWidth="1.5" />
    </svg>
);

const ThemePicker = ({ value, onChange }) => (
    <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-widest text-text-muted">Map style</p>
        <div role="radiogroup" aria-label="Map style" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Object.entries(THEMES).map(([key, t]) => (
                <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={value === key}
                    onClick={() => onChange(key)}
                    className={`flex flex-col items-center gap-1 rounded-xl border p-2 text-xs font-bold transition-colors ${value === key ? 'border-gold bg-night-card text-snow' : 'border-frost/15 text-text-muted hover:border-frost/40'}`}
                >
                    <ThemeSwatch t={t} />
                    {t.label}
                </button>
            ))}
        </div>
    </div>
);

const ReelView = ({ title, stops, onBack, theme, onTheme }) => {
    const [ready, setReady] = useState(false);
    const [exporting, setExporting] = useState(null); // { progress } while rendering
    const [download, setDownload] = useState(null);
    const [error, setError] = useState('');
    const abortRef = useRef(null);

    const inputProps = useMemo(() => ({
        title,
        theme,
        stops: stops.map((s, i) => ({ name: s.name, lat: s.lat, lng: s.lng, mode: s.mode, route: s.route || null, photos: s.photos.map((p) => p.url), wayPhotos: i > 0 ? (s.wayPhotos || []).map((p) => p.url) : [] })),
    }), [title, stops, theme]);
    const duration = useMemo(() => buildTimeline(inputProps.stops).durationInFrames, [inputProps]);

    useEffect(() => {
        loadWorld().then(() => setReady(true)).catch(() => setError('Could not load the world map.'));
    }, []);

    useEffect(() => () => {
        abortRef.current?.abort();
        if (download) URL.revokeObjectURL(download.url);
    }, [download]);

    const startExport = async () => {
        setError('');
        setDownload(null);
        const controller = new AbortController();
        abortRef.current = controller;
        setExporting({ progress: 0 });
        try {
            // Make sure the comic and manga lettering is loaded before any frame is drawn
            await document.fonts?.load('40px "Bangers"').catch(() => {});
            const renderer = await import('@remotion/web-renderer');
            const format = await pickFormat(renderer);
            const result = await renderer.renderMediaOnWeb({
                composition: {
                    id: 'travel-reel',
                    component: TravelReel,
                    width: REEL.width,
                    height: REEL.height,
                    fps: REEL.fps,
                    durationInFrames: duration,
                },
                inputProps,
                container: format.container,
                videoCodec: format.videoCodec,
                muted: true,
                videoBitrate: 'high',
                signal: controller.signal,
                licenseKey: 'free-license',
                onProgress: (p) => setExporting({ progress: p.progress }),
            });
            const blob = await result.getBlob();
            const safe = title.trim().replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'trip';
            setDownload({ url: URL.createObjectURL(blob), name: `${safe}-reel.${format.ext}`, size: blob.size });
        } catch (e) {
            if (e?.name !== 'AbortError' && !controller.signal.aborted) setError(e?.message || 'Export failed.');
        } finally {
            setExporting(null);
            abortRef.current = null;
        }
    };

    return (
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-6 px-4 py-6 lg:flex-row lg:items-start">
            <div className="w-full max-w-[380px] shrink-0 overflow-hidden rounded-3xl border border-frost/15 bg-night-card shadow-2xl">
                {ready ? (
                    <Player
                        component={TravelReel}
                        inputProps={inputProps}
                        durationInFrames={duration}
                        fps={REEL.fps}
                        compositionWidth={REEL.width}
                        compositionHeight={REEL.height}
                        style={{ width: '100%', aspectRatio: '9 / 16' }}
                        controls
                        autoPlay
                        loop
                        acknowledgeRemotionLicense
                    />
                ) : (
                    <div className="flex aspect-[9/16] items-center justify-center text-text-muted">
                        <Loader2 className="animate-spin" aria-hidden="true" /> <span className="ml-2">Loading map…</span>
                    </div>
                )}
            </div>

            <div className="w-full flex-1 space-y-4">
                <button type="button" onClick={onBack} className="flex items-center gap-2 text-sm font-bold text-frost hover:text-snow">
                    <ArrowLeft size={16} aria-hidden="true" /> Back to editing
                </button>
                <h2 className="font-display text-3xl font-bold text-snow">{title}</h2>
                <p className="text-text-muted">
                    {stops.length} stops · {(duration / REEL.fps).toFixed(0)} second reel · 1080 × 1920, ready for Reels, Shorts and Stories.
                </p>

                {!exporting && <ThemePicker value={theme} onChange={(k) => { setDownload(null); onTheme(k); }} />}

                {!exporting && (
                    <button
                        type="button"
                        onClick={startExport}
                        disabled={!ready}
                        className="flex items-center gap-2 rounded-full bg-holly px-6 py-3 font-bold text-snow hover:bg-holly-deep disabled:opacity-50"
                    >
                        <Film size={18} aria-hidden="true" /> Create video file
                    </button>
                )}

                {exporting && (
                    <div className="space-y-2 rounded-2xl border border-frost/15 bg-night-card p-4" aria-live="polite">
                        <div className="flex items-center justify-between text-sm text-snow">
                            <span className="flex items-center gap-2"><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Rendering your reel…</span>
                            <span className="tabular-nums">{Math.round(exporting.progress * 100)}%</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-night">
                            <div className="h-full rounded-full bg-gold transition-[width]" style={{ width: `${exporting.progress * 100}%` }} />
                        </div>
                        <p className="text-xs text-text-muted">Keep this tab open. Everything happens on your device; nothing is uploaded.</p>
                        <button type="button" onClick={() => abortRef.current?.abort()} className="text-xs font-bold text-holly hover:underline">Cancel</button>
                    </div>
                )}

                {download && (
                    <a
                        href={download.url}
                        download={download.name}
                        className="inline-flex items-center gap-2 rounded-full bg-pine px-6 py-3 font-bold text-snow hover:bg-pine-deep"
                    >
                        <Download size={18} aria-hidden="true" /> Download {download.name} ({(download.size / 1e6).toFixed(1)} MB)
                    </a>
                )}

                {error && <p role="alert" className="rounded-xl bg-holly/15 p-3 text-sm text-[#ff9aa8]">{error}</p>}
            </div>
        </div>
    );
};

// ---- Place search with suggestions while typing ---------------------------------

const PlaceSearch = ({ query, setQuery, near, onPick, onSubmit, searching, disabled, label }) => {
    const [suggestions, setSuggestions] = useState([]);
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(-1);
    const submitted = useRef(''); // a query already sent to the full search shows no dropdown
    const nearKey = near ? `${near.lat},${near.lng}` : '';

    useEffect(() => {
        const q = query.trim();
        if (q.length < 2) {
            setSuggestions([]);
            setOpen(false);
            return undefined;
        }
        const controller = new AbortController();
        // Wait for a short pause in typing, and cancel the previous lookup
        const timer = setTimeout(() => {
            suggestPlaces(q, near, controller.signal)
                .then((found) => { setSuggestions(found); setActive(-1); setOpen(submitted.current !== q); })
                .catch(() => { /* typing on, or the service is down: Enter still searches */ });
        }, 250);
        return () => { clearTimeout(timer); controller.abort(); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [query, nearKey]);

    const pick = (place) => {
        setOpen(false);
        setSuggestions([]);
        onPick(place);
    };
    const showList = open && suggestions.length > 0;
    const onKeyDown = (e) => {
        if (e.key === 'ArrowDown' && suggestions.length) {
            e.preventDefault();
            setOpen(true);
            setActive((i) => (i + 1) % suggestions.length);
        } else if (e.key === 'ArrowUp' && suggestions.length) {
            e.preventDefault();
            setOpen(true);
            setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
        } else if (e.key === 'Enter' && showList && active >= 0) {
            e.preventDefault();
            pick(suggestions[active]);
        } else if (e.key === 'Escape') {
            setOpen(false);
        }
    };

    return (
        <form onSubmit={(e) => { e.preventDefault(); submitted.current = query.trim(); setOpen(false); onSubmit(); }} className="space-y-2">
            <label htmlFor="place-search" className="text-xs font-bold uppercase tracking-widest text-text-muted">{label}</label>
            <div className="relative flex gap-2">
                <input
                    id="place-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onKeyDown}
                    onFocus={() => suggestions.length && setOpen(true)}
                    onBlur={() => setOpen(false)}
                    placeholder="Search a city, landmark or place"
                    autoComplete="off"
                    role="combobox"
                    aria-expanded={showList}
                    aria-controls="place-suggestions"
                    aria-autocomplete="list"
                    aria-activedescendant={showList && active >= 0 ? `place-option-${active}` : undefined}
                    className="min-w-0 flex-1 rounded-xl border border-frost/15 bg-night-card px-3 py-2 outline-none focus:border-gold"
                    disabled={disabled}
                />
                <button type="submit" disabled={searching || disabled} className="rounded-xl bg-gold px-3 text-night disabled:opacity-50" aria-label="Search">
                    {searching ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                </button>
                {showList && (
                    <ul
                        id="place-suggestions"
                        role="listbox"
                        aria-label="Suggested places"
                        className="absolute left-0 right-12 top-full z-[1000] mt-1 max-h-80 overflow-y-auto rounded-xl border border-frost/20 bg-night-soft py-1 shadow-2xl"
                    >
                        {suggestions.map((r, i) => {
                            const Icon = r.landmark ? Landmark : MapPin;
                            return (
                                <li
                                    key={`${r.lat},${r.lng},${i}`}
                                    id={`place-option-${i}`}
                                    role="option"
                                    aria-selected={i === active}
                                    // mousedown, not click, so the input doesn't lose focus and close the list first
                                    onMouseDown={(e) => { e.preventDefault(); pick(r); }}
                                    onMouseEnter={() => setActive(i)}
                                    className={`flex cursor-pointer items-start gap-2 px-3 py-2 ${i === active ? 'bg-night-card' : ''}`}
                                >
                                    <Icon size={16} className={`mt-0.5 shrink-0 ${r.landmark ? 'text-gold' : 'text-text-muted'}`} aria-hidden="true" />
                                    <span className="min-w-0">
                                        <span className="block truncate font-bold text-snow">{r.name}</span>
                                        {r.detail && <span className="block truncate text-xs text-text-muted">{r.detail}</span>}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </div>
        </form>
    );
};

// ---- Page --------------------------------------------------------------------

export default function TravelEditorPage() {
    const initial = useMemo(loadDraft, []);
    const [title, setTitle] = useState(initial.title);
    const [stops, setStops] = useState(initial.stops);
    const [routes, setRoutes] = useState(initial.routes);
    const [nextMode, setNextMode] = useState('car');
    const [query, setQuery] = useState('');
    const [results, setResults] = useState([]);
    const [searching, setSearching] = useState(false);
    const [adding, setAdding] = useState(false);
    const [message, setMessage] = useState('');
    const [focus, setFocus] = useState(null);
    const [view, setView] = useState('edit');
    const [theme, setTheme] = useState(loadThemeKey);
    useEffect(() => { try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage blocked */ } }, [theme]);
    const [importing, setImporting] = useState(null); // { label, done, total } while building from photos
    const importRef = useRef(null);

    useEffect(() => { document.title = 'Travelator · Trip reel maker'; }, []);
    useEffect(() => { saveDraft(title, stops, routes); }, [title, stops, routes]);

    // Find a land-following route for every car and train leg that doesn't have one yet
    const keys = legKeys(stops);
    const missing = keys.filter((k) => k && !routes[k]);
    const missingSig = missing.join('|');
    useEffect(() => {
        // getRoute caches by key, so asking again while a leg is still being traced is free
        keys.forEach((k, i) => {
            if (!k || routes[k]) return;
            getRoute(stops[i - 1], stops[i], stops[i].mode)
                .then((pts) => { if (pts) setRoutes((prev) => ({ ...prev, [k]: pts })); })
                .catch(() => { /* getRoute falls back to a drawn curve, so this is not expected */ });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [missingSig]);

    const addStop = useCallback((place) => {
        setStops((prev) => {
            if (prev.length >= MAX_STOPS) return prev;
            return [...prev, { id: newId(), name: place.name, lat: place.lat, lng: place.lng, mode: prev.length ? nextMode : null, photos: [], wayPhotos: [] }];
        });
        setFocus({ lat: place.lat, lng: place.lng, t: Date.now() });
        setResults([]);
        setQuery('');
        setMessage(`Added ${place.name}.`);
    }, [nextMode]);

    const onMapPick = useCallback(async (lat, lng) => {
        setAdding(true);
        try {
            const name = await reverseLookup(lat, lng);
            addStop({ name, lat, lng });
        } finally {
            setAdding(false);
        }
    }, [addStop]);

    const onSearch = async () => {
        if (!query.trim()) return;
        setSearching(true);
        setMessage('');
        try {
            const found = await searchPlaces(query.trim());
            setResults(found);
            if (!found.length) setMessage('No places found. Try another name, or click the map.');
        } catch {
            setMessage('Place search is unavailable right now. You can still click the map to add places.');
        } finally {
            setSearching(false);
        }
    };

    const update = (id, patch) => setStops((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    const remove = (id) => setStops((prev) => {
        const gone = prev.find((s) => s.id === id);
        [...(gone?.photos || []), ...(gone?.wayPhotos || [])].forEach((p) => URL.revokeObjectURL(p.url));
        const next = prev.filter((s) => s.id !== id);
        if (next[0]) next[0] = { ...next[0], mode: null };
        return next;
    });
    const move = (index, dir) => setStops((prev) => {
        const j = index + dir;
        if (j < 0 || j >= prev.length) return prev;
        const next = [...prev];
        [next[index], next[j]] = [next[j], next[index]];
        // The first stop has no way of arriving; give a moved-down first stop a mode
        return next.map((s, k) => ({ ...s, mode: k === 0 ? null : s.mode || nextMode }));
    });
    const addPhotos = async (id, files) => {
        const stop = stops.find((s) => s.id === id);
        const room = MAX_PHOTOS - (stop?.photos.length || 0);
        const prepared = [];
        for (const f of files.slice(0, room)) {
            try { prepared.push(await preparePhoto(f)); } catch { setMessage(`Could not read ${f.name}.`); }
        }
        setStops((prev) => prev.map((s) => (s.id === id ? { ...s, photos: [...s.photos, ...prepared].slice(0, MAX_PHOTOS) } : s)));
    };
    const removePhoto = (id, photoId) => setStops((prev) => prev.map((s) => {
        if (s.id !== id) return s;
        s.photos.filter((p) => p.id === photoId).forEach((p) => URL.revokeObjectURL(p.url));
        return { ...s, photos: s.photos.filter((p) => p.id !== photoId) };
    }));
    // Build stops from a batch of photos, using the place and time saved in each one
    const buildFromPhotos = async (files) => {
        if (!files.length) return;
        setMessage('');
        const items = [];
        let unreadable = 0;
        for (let k = 0; k < files.length; k += 1) {
            setImporting({ label: 'Reading photos', done: k, total: files.length });
            const info = await readPhotoInfo(files[k]);
            try {
                items.push({ ...info, ...(await preparePhoto(files[k])) });
            } catch {
                unreadable += 1;
            }
        }
        const located = items.filter((p) => p.lat != null);
        if (!located.length) {
            items.forEach((p) => URL.revokeObjectURL(p.url));
            setImporting(null);
            setMessage(unreadable === files.length
                ? 'These photos could not be opened in this browser. Try JPEG photos, or add places by search or on the map.'
                : 'None of these photos has a location saved in it. Add places by search or on the map, then add the photos to each stop.');
            return;
        }
        let groups = groupIntoStops(located);
        const left = placeByTime(groups, items.filter((p) => p.lat == null));
        const room = MAX_STOPS - stops.length;
        const dropped = groups.slice(room);
        groups = groups.slice(0, room);

        const named = [];
        for (let k = 0; k < groups.length; k += 1) {
            setImporting({ label: 'Naming places', done: k, total: groups.length });
            const g = groups[k];
            named.push({ ...g, name: await reverseLookup(g.anchor.lat, g.anchor.lng) });
        }
        setImporting(null);

        // Free the photos that didn't make it in
        const used = new Set(groups.flatMap((g) => [...g.photos, ...g.wayPhotos]).map((p) => p.url));
        items.forEach((p) => { if (!used.has(p.url)) URL.revokeObjectURL(p.url); });

        const keepPhoto = ({ id, url }) => ({ id, url });
        setStops((prev) => {
            const out = [...prev];
            named.forEach((g) => {
                const before = out[out.length - 1];
                out.push({
                    id: newId(),
                    name: g.name,
                    lat: g.anchor.lat,
                    lng: g.anchor.lng,
                    mode: before ? guessMode(distanceKm(before, g.anchor)) : null,
                    photos: g.photos.map(keepPhoto),
                    wayPhotos: before ? g.wayPhotos.map(keepPhoto) : [],
                });
            });
            return out;
        });
        if (named.length) setFocus({ lat: named[0].anchor.lat, lng: named[0].anchor.lng, t: Date.now() });

        const notes = [`Added ${named.length} stop${named.length === 1 ? '' : 's'} from ${files.length} photo${files.length === 1 ? '' : 's'}.`];
        const spare = groups.reduce((n, g) => n + g.extra, 0);
        if (spare) notes.push(`${spare} similar photo${spare === 1 ? ' was' : 's were'} left out (up to ${MAX_PHOTOS} per stop).`);
        if (left.length) notes.push(`${left.length} photo${left.length === 1 ? ' has' : 's have'} no location, so ${left.length === 1 ? "it wasn't" : "they weren't"} added.`);
        if (unreadable) notes.push(`${unreadable} couldn't be opened in this browser.`);
        if (dropped.length) notes.push(`Stopped at ${MAX_STOPS} stops.`);
        notes.push('Check each way of travel below.');
        setMessage(notes.join(' '));
    };

    const addWayPhotos = async (id, files) => {
        const stop = stops.find((s) => s.id === id);
        const room = TIMING.maxWayPhotos - (stop?.wayPhotos?.length || 0);
        const prepared = [];
        for (const f of files.slice(0, room)) {
            try { prepared.push(await preparePhoto(f)); } catch { setMessage(`Could not read ${f.name}.`); }
        }
        setStops((prev) => prev.map((s) => (s.id === id ? { ...s, wayPhotos: [...(s.wayPhotos || []), ...prepared].slice(0, TIMING.maxWayPhotos) } : s)));
    };
    const removeWayPhoto = (id, photoId) => setStops((prev) => prev.map((s) => {
        if (s.id !== id) return s;
        (s.wayPhotos || []).filter((p) => p.id === photoId).forEach((p) => URL.revokeObjectURL(p.url));
        return { ...s, wayPhotos: (s.wayPhotos || []).filter((p) => p.id !== photoId) };
    }));
    const clearAll = () => {
        stops.forEach((s) => [...s.photos, ...(s.wayPhotos || [])].forEach((p) => URL.revokeObjectURL(p.url)));
        setStops([]);
        setMessage('Trip cleared.');
    };

    const totalKm = stops.slice(1).reduce((sum, s, i) => sum + distanceKm(stops[i], s), 0);

    return (
        <div className="min-h-screen bg-night text-snow">
            <header className="flex items-center justify-between gap-3 border-b border-frost/10 bg-night-soft px-4 py-3">
                <h1 className="font-display text-lg font-bold md:text-xl">Travelator <span className="hidden font-sans text-sm font-semibold text-text-muted sm:inline">· trip reel maker</span></h1>
                <span className="hidden text-xs text-text-muted sm:block">Photos stay on your device</span>
            </header>

            {view === 'reel' ? (
                <ReelView title={title} stops={stops.map((s, i) => ({ ...s, route: keys[i] ? routes[keys[i]] : null }))} onBack={() => setView('edit')} theme={theme} onTheme={setTheme} />
            ) : (
                <div className="grid md:h-[calc(100vh-57px)] md:grid-cols-[400px_1fr]">
                    <aside className="order-2 flex flex-col gap-4 overflow-y-auto p-4 md:order-1 [&>*]:shrink-0">
                        <div>
                            <label htmlFor="trip-title" className="text-xs font-bold uppercase tracking-widest text-text-muted">Trip name</label>
                            <input
                                id="trip-title"
                                value={title}
                                maxLength={40}
                                onChange={(e) => setTitle(e.target.value)}
                                className="mt-1 w-full rounded-xl border border-frost/15 bg-night-card px-3 py-2 font-bold outline-none focus:border-gold"
                            />
                        </div>

                        <div>
                            <button
                                type="button"
                                onClick={() => importRef.current?.click()}
                                disabled={Boolean(importing) || stops.length >= MAX_STOPS}
                                className="flex w-full items-center gap-3 rounded-2xl border border-dashed border-gold/50 bg-night-card px-4 py-3 text-left hover:border-gold disabled:opacity-60"
                            >
                                {importing ? <Loader2 size={22} className="shrink-0 animate-spin text-gold" aria-hidden="true" /> : <Images size={22} className="shrink-0 text-gold" aria-hidden="true" />}
                                <span>
                                    <span className="block font-bold text-snow">
                                        {importing ? `${importing.label}… ${importing.done + 1} of ${importing.total}` : 'Build from trip photos'}
                                    </span>
                                    <span className="block text-xs text-text-muted">Uses the place and time saved in each photo. Nothing is uploaded.</span>
                                </span>
                            </button>
                            <input
                                ref={importRef}
                                type="file"
                                accept="image/*"
                                multiple
                                hidden
                                aria-label="Trip photos to build stops from"
                                onChange={(e) => { const files = [...e.target.files]; e.target.value = ''; buildFromPhotos(files); }}
                            />
                        </div>

                        <div className="space-y-2">
                            <PlaceSearch
                                query={query}
                                setQuery={setQuery}
                                near={stops[stops.length - 1]}
                                onPick={addStop}
                                onSubmit={onSearch}
                                searching={searching}
                                disabled={stops.length >= MAX_STOPS}
                                label={stops.length ? 'Add the next place' : 'Where did your trip start?'}
                            />
                            {stops.length > 0 && (
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs text-text-muted">Getting there by</span>
                                    <ModePicker value={nextMode} onChange={setNextMode} label="How you travel to the next place" />
                                </div>
                            )}
                            <p className="flex items-center gap-1.5 text-xs text-text-muted">
                                <MapPin size={12} aria-hidden="true" /> Or click anywhere on the map.{adding ? ' Looking up the place…' : ''}
                            </p>
                        </div>

                        {results.length > 0 && (
                            <ul className="space-y-1" aria-label="Search results">
                                {results.map((r, i) => (
                                    <li key={`${r.lat},${r.lng},${i}`}>
                                        <button type="button" onClick={() => addStop(r)} className="w-full rounded-xl px-3 py-2 text-left hover:bg-night-card">
                                            <div className="font-bold">{r.name}</div>
                                            <div className="truncate text-xs text-text-muted">{r.detail}</div>
                                        </button>
                                    </li>
                                ))}
                            </ul>
                        )}

                        <p aria-live="polite" className="min-h-[1rem] text-xs text-frost">{message}</p>

                        {stops.length > 0 && (
                            <>
                                <div className="flex items-center justify-between text-xs text-text-muted">
                                    <span>{stops.length} stop{stops.length > 1 ? 's' : ''} · {Math.round(totalKm).toLocaleString('en-IN')} km</span>
                                    <button type="button" onClick={clearAll} className="font-bold hover:text-holly">Clear trip</button>
                                </div>
                                <ol className="space-y-3">
                                    {stops.map((s, i) => (
                                        <StopCard
                                            key={s.id}
                                            stop={s}
                                            prev={stops[i - 1]}
                                            index={i}
                                            total={stops.length}
                                            onChange={(patch) => update(s.id, patch)}
                                            onRemove={() => remove(s.id)}
                                            onMove={(dir) => move(i, dir)}
                                            onAddPhotos={(files) => addPhotos(s.id, files)}
                                            onRemovePhoto={(pid) => removePhoto(s.id, pid)}
                                            onAddWayPhotos={(files) => addWayPhotos(s.id, files)}
                                            onRemoveWayPhoto={(pid) => removeWayPhoto(s.id, pid)}
                                        />
                                    ))}
                                </ol>
                            </>
                        )}

                        <button
                            type="button"
                            onClick={() => setView('reel')}
                            disabled={stops.length < 2 || missing.length > 0}
                            className="sticky bottom-0 mt-auto flex items-center justify-center gap-2 rounded-full bg-holly px-6 py-3 font-bold text-snow shadow-lg hover:bg-holly-deep disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            {missing.length > 0 && stops.length >= 2 ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <Film size={18} aria-hidden="true" />}
                            {stops.length < 2 ? 'Add at least 2 places' : missing.length > 0 ? 'Tracing roads and rails…' : 'Done, make my reel'}
                        </button>
                    </aside>

                    <div className="order-1 h-[50vh] md:order-2 md:h-full">
                        <TripMap stops={stops} routes={routes} onPick={onMapPick} adding={adding} focus={focus} />
                    </div>
                </div>
            )}
        </div>
    );
}
