/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#13233A', 700: '#2B3C55', 500: '#5B6B82', 300: '#A3AEBF', 100: '#E4E8EE' },
        paper: { DEFAULT: '#F4F5F7', 50: '#FAFBFC' },
        signal: { DEFAULT: '#1F4FD8', 600: '#1A43B8', 50: '#EAF0FD' },
        stamp: { DEFAULT: '#D6402B', 50: '#FCEDEA' },
        sent: { DEFAULT: '#177A5A', 50: '#E5F5EE' },
        wait: { DEFAULT: '#A8650B', 50: '#FBF1DF' },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: { card: '0 1px 2px rgba(19,35,58,.06), 0 1px 1px rgba(19,35,58,.04)' },
    },
  },
  plugins: [],
};
