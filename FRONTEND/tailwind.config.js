/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Reads CSS custom properties (set at runtime from the tenant's
        // saved accent color -- see utils/theme.ts) instead of fixed hex
        // values, so Settings > Branding actually retints the app. The
        // `<alpha-value>` placeholder is Tailwind's documented pattern for
        // keeping opacity modifiers (e.g. bg-brand-600/50) working with
        // CSS-variable-based colors; --brand-* holds space-separated RGB,
        // e.g. "99 102 241", not a full rgb(...) string.
        brand: {
          50: 'rgb(var(--brand-50) / <alpha-value>)', 100: 'rgb(var(--brand-100) / <alpha-value>)',
          200: 'rgb(var(--brand-200) / <alpha-value>)', 300: 'rgb(var(--brand-300) / <alpha-value>)',
          400: 'rgb(var(--brand-400) / <alpha-value>)', 500: 'rgb(var(--brand-500) / <alpha-value>)',
          600: 'rgb(var(--brand-600) / <alpha-value>)', 700: 'rgb(var(--brand-700) / <alpha-value>)',
          800: 'rgb(var(--brand-800) / <alpha-value>)', 900: 'rgb(var(--brand-900) / <alpha-value>)',
          950: 'rgb(var(--brand-950) / <alpha-value>)',
        },
        ink: {
          50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1',
          400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155',
          800: '#1e293b', 900: '#0f172a', 950: '#020617',
        },
        sidebar: { DEFAULT: '#0b1220', accent: '#131c31', hover: '#1b2740' },
        accent: { teal: '#14b8a6', violet: '#8b5cf6', blue: '#3b82f6' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgba(15,23,42,0.08), 0 1px 2px -1px rgba(15,23,42,0.06)',
        soft: '0 4px 24px -8px rgba(15,23,42,0.12)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-in': { '0%': { transform: 'translateX(100%)' }, '100%': { transform: 'translateX(0)' } },
        'slide-up': { '0%': { transform: 'translateY(8px)', opacity: '0' }, '100%': { transform: 'translateY(0)', opacity: '1' } },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'slide-in': 'slide-in 0.25s cubic-bezier(0.16,1,0.3,1)',
        'slide-up': 'slide-up 0.2s ease-out',
      },
    },
  },
  plugins: [],
};