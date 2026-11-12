/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        dark: {
          950: '#09090b',
          900: '#0f0f11',
          850: '#141417',
          800: '#18181b',
          700: '#27272a',
          600: '#3f3f46',
        }
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      keyframes: {
        loader: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(250%)' },
        }
      },
      animation: {
        loader: 'loader 1.1s cubic-bezier(0.65, 0, 0.35, 1) infinite',
      }
    },
  },
  plugins: [],
}
