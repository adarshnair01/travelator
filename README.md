# Travelator

A tool for creating travel montage videos.

Turn a trip into a vertical travel reel, right in the browser: **https://travelator.adarshnair.in**

1. Search for each place you visited, or click it on the map.
2. Pick how you got there from the last stop: car, train or flight.
3. Add up to four photos at each stop.
4. Press **Done, make my reel** to watch it, then **Download** to save the video (MP4, or WebM where MP4 isn't supported).

Photos never leave your device; the video is made in your browser.

## How it works

- **Editor:** React, Leaflet with OpenStreetMap tiles, and Nominatim for place search.
- **Reel:** a [Remotion](https://www.remotion.dev) composition at 1080×1920, 30 fps. Roads wind, flights follow an arc and trains run on a track, all drawn on a world map from `world-atlas`.
- **Export:** `@remotion/web-renderer` encodes the video in the browser.

| File | What it holds |
| --- | --- |
| `src/travel/TravelEditorPage.jsx` | Editor page, player and export |
| `src/travel/TravelReel.jsx` | The video composition |
| `src/travel/geo.js` | Map camera, timeline and route curves |
| `src/travel/geocode.js` | Place search and reverse lookup |
| `src/travel/world.js` | Loads the world map |

## Develop

```sh
npm install
npm run dev     # http://localhost:5173
npm run lint
npm run build
```

Pushing to `main` builds the site and deploys it to GitHub Pages (`.github/workflows/deploy.yml`). `public/CNAME` sets the custom domain.

Map data © OpenStreetMap contributors.
