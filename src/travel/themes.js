// Map styles for the reel. Each one sets the map (sea, land, borders, texture) and
// the look of the text panels drawn over it. Route and vehicle colours stay the same
// in every style so car, bike, train and flight are always easy to tell apart.
import { createContext, useContext } from 'react';

const DARK_TEXT = { text: '#14161c', muted: '#5b6372' };
const LIGHT_TEXT = { text: '#f4f7fc', muted: '#a6b4cc' };

export const THEMES = {
    minimal: {
        label: 'Minimal',
        sea: '#e4ebf2', land: '#ffffff', landStroke: '#c5d0dc', landStrokeWidth: 1.5,
        border: '#d3dbe5', borderDash: '6 6', grid: null,
        panel: 'rgba(255, 255, 255, 0.94)', panelBorder: '1px solid rgba(20, 22, 28, 0.08)', panelShadow: '0 12px 30px rgba(20, 30, 50, 0.18)',
        ...DARK_TEXT, accent: '#d99a00', barOff: 'rgba(20, 22, 28, 0.15)', chip: 'rgba(20, 22, 28, 0.06)',
        veil: 'rgba(244, 247, 252, 0.72)', markerOff: '#ffffff', markerOffStroke: '#9aa6b6', markerOffText: '#5b6372',
    },
    mono: {
        label: 'Black & white',
        sea: '#ffffff', seaPattern: 'hatch', land: '#ffffff', landStroke: '#111111', landStrokeWidth: 3,
        border: '#111111', borderDash: '3 7', grid: null,
        panel: '#ffffff', panelBorder: '3px solid #111111', panelShadow: 'none',
        text: '#111111', muted: '#555555', accent: '#111111', barOff: 'rgba(0, 0, 0, 0.15)', chip: 'rgba(0, 0, 0, 0.06)',
        veil: 'rgba(255, 255, 255, 0.75)', markerOff: '#ffffff', markerOffStroke: '#111111', markerOffText: '#111111',
    },
    comic: {
        label: 'Comic',
        sea: '#38bdf8', seaPattern: 'halftone', land: '#ffe45c', landStroke: '#000000', landStrokeWidth: 5,
        border: '#000000', borderDash: '10 8', grid: null,
        panel: '#ffffff', panelBorder: '5px solid #000000', panelShadow: '10px 10px 0 #000000',
        text: '#000000', muted: '#333333', accent: '#e11d48', barOff: 'rgba(0, 0, 0, 0.2)', chip: '#fff3b0',
        veil: 'rgba(255, 228, 92, 0.55)', markerOff: '#ffffff', markerOffStroke: '#000000', markerOffText: '#000000',
        titleFont: '"Bangers", "Impact", system-ui, sans-serif', titleSpacing: 3,
    },
    manga: {
        label: 'Manga',
        sea: '#ffffff', seaPattern: 'speed', land: '#ffffff', landPattern: 'tone', landStroke: '#000000', landStrokeWidth: 4,
        border: '#000000', borderDash: '2 6', grid: null,
        panel: '#ffffff', panelBorder: '4px solid #000000', panelShadow: '6px 6px 0 #000000',
        text: '#000000', muted: '#444444', accent: '#000000', barOff: 'rgba(0, 0, 0, 0.18)', chip: 'rgba(0, 0, 0, 0.07)',
        veil: 'rgba(255, 255, 255, 0.78)', markerOff: '#ffffff', markerOffStroke: '#000000', markerOffText: '#000000',
        titleFont: '"Bangers", "Impact", system-ui, sans-serif', titleSpacing: 2,
    },
    vintage: {
        label: 'Vintage atlas',
        sea: '#a7c4c2', land: '#efe1bd', landStroke: '#9b7b4f', landStrokeWidth: 1.8,
        border: '#9b7b4f', borderDash: '7 5', grid: '#8fb0ad',
        panel: 'rgba(247, 238, 214, 0.95)', panelBorder: '2px solid #9b7b4f', panelShadow: '0 10px 24px rgba(60, 40, 10, 0.25)',
        text: '#3b2a17', muted: '#7a6142', accent: '#b5651d', barOff: 'rgba(59, 42, 23, 0.18)', chip: 'rgba(155, 123, 79, 0.15)',
        veil: 'rgba(239, 225, 189, 0.7)', markerOff: '#f7eed6', markerOffStroke: '#9b7b4f', markerOffText: '#7a6142',
        titleFont: 'Georgia, "Times New Roman", serif',
    },
    midnight: {
        label: 'Midnight',
        sea: '#0b1628', land: '#1c2b45', landStroke: null, border: '#2e4366', borderDash: null, grid: '#13213a',
        panel: 'rgba(10, 19, 36, 0.82)', panelBorder: 'none', panelShadow: 'none',
        ...LIGHT_TEXT, accent: '#f0c34e', barOff: 'rgba(255, 255, 255, 0.18)', chip: 'rgba(255, 255, 255, 0.08)',
        veil: 'rgba(7, 14, 28, 0.55)', markerOff: '#22324f', markerOffStroke: '#4c6187', markerOffText: '#a6b4cc',
    },
};

export const DEFAULT_THEME = 'minimal';
export const themeFor = (key) => THEMES[key] || THEMES[DEFAULT_THEME];

export const ReelTheme = createContext(THEMES[DEFAULT_THEME]);
export const useReelTheme = () => useContext(ReelTheme);

