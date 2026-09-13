/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: '#111111',
        sidebar: '#1a1a1a',
        primary: '#3b82f6', // Bright Blue
        secondary: '#1e1e1e',
        accent: '#2d2d2d',
      },
    },
  },
  plugins: [],
}
