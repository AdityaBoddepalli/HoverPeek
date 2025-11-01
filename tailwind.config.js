/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,html}",
  ],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        surface: 'var(--surface)',
        text: {
          DEFAULT: 'var(--text)',
          weak: 'var(--text-weak)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          weak: 'var(--accent-weak)',
        },
        line: 'var(--line)',
        safe: 'var(--safe)',
        warn: 'var(--warn)',
        danger: 'var(--danger)',
        info: 'var(--info)',
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', 'SF Pro Text', 'Segoe UI', 'Roboto', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        title: '13.5px',
        body: '12.5px',
        micro: '11px',
      },
      fontWeight: {
        title: '600',
        body: '400',
        chip: '500',
      },
      borderRadius: {
        card: '14px',
        pill: '999px',
      },
      boxShadow: {
        light: '0 12px 32px rgba(16, 24, 40, .12), 0 2px 6px rgba(16, 24, 40, .08)',
        dark: '0 20px 50px rgba(0, 0, 0, .45), 0 1px 0 rgba(255,255,255,.04) inset',
      },
    },
  },
  plugins: [],
}

