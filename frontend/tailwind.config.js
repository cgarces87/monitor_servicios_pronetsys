/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Tipografia corporativa Pronetsys. "Como W01 Bold" se aplica de forma
      // global (ver src/index.css @font-face). Fallback a sans-serif del sistema
      // mientras carga o si la licencia de la fuente no esta disponible.
      // 'Como W01 Bold' va primero: si algun dia se auto-hospeda (licencia
      // Monotype) toma precedencia automatica. Mientras tanto, la fuente activa
      // es Montserrat (sustituta libre cargada via @fontsource en main.tsx).
      fontFamily: {
        sans: [
          'Como W01 Bold',
          'Montserrat',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      colors: {
        // Paleta tomada del logotipo oficial Pronetsys (azul navy del wordmark)
        // y del azul primario del catalogo de servicios (#0065cb).
        brand: {
          DEFAULT: '#1e3a8a',
          dark: '#16275c',
          light: '#0065cb',
          accent: '#77b978',
        },
        estado: {
          up: '#22c55e',
          down: '#ef4444',
          paused: '#94a3b8',
        },
      },
    },
  },
  plugins: [],
};
