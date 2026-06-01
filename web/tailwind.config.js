/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: {
          DEFAULT: '#22C55E',
          press: '#16A34A',
        },
        cream: '#ECFDF3',
        ink: '#0C0B0B',
      },
      fontFamily: {
        sans: ['Geist Sans', 'Helvetica Neue', 'Arial', 'sans-serif'],
        title: ['Bricolage Grotesque', 'Geist Sans', 'Helvetica Neue', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
