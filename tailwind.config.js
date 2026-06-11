/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#0B0F19',
        card: '#161B26',
        primary: {
          50: '#F0F5FF',
          100: '#E1E9FF',
          500: '#3B82F6',
          600: '#2563EB',
          700: '#1D4ED8',
        },
        nordic: {
          gold: '#D4AF37',
          blue: '#1A365D',
          sky: '#38BDF8',
          red: '#EF4444',
          gray: '#94A3B8',
        }
      },
      fontFamily: {
        sans: ['Outfit', 'Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
