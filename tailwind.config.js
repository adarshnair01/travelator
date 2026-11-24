/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'text-muted': '#a0b2cf',
        night: '#0a1324',
        'night-soft': '#111d36',
        'night-card': '#16233f',
        holly: '#d4243b',
        'holly-deep': '#9e1428',
        gold: '#f0c34e',
        snow: '#f4f7fc',
        frost: '#a9d4f5',
      },
    },
    fontFamily: {
      sans: ['"Nunito"', 'sans-serif'],
      display: ['"Playfair Display"', 'serif'],
      mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
    },
  },
  plugins: [],
}
