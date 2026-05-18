import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand via CSS variables (admin-overridable)
        brand: {
          primary: 'hsl(var(--brand-primary) / <alpha-value>)',
          accent:  'hsl(var(--brand-accent)  / <alpha-value>)',
        },
        // Shadcn/UI semantic tokens
        background: 'hsl(var(--background))',
        foreground:  'hsl(var(--foreground))',
        card: {
          DEFAULT:    'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT:    'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        primary: {
          DEFAULT:    'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT:    'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT:    'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT:    'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT:    'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        border:  'hsl(var(--border))',
        input:   'hsl(var(--input))',
        ring:    'hsl(var(--ring))',

        // Yorki Navy scale — primary chrome, text, interactive
        navy: {
          50:  '#F0F2F7',
          100: '#D8DCE8',
          200: '#B0BAD1',
          300: '#8896BA',
          400: '#6A7BA3',
          500: '#4E5F8C',
          600: '#3A4A73',
          700: '#2F3650',
          800: '#1E2338',
          900: '#0F1220',
        },
        // Yorki Bronze scale — accent, warmth, priority signals
        bronze: {
          50:  '#FAF5EF',
          100: '#EFE0C8',
          200: '#DEC49A',
          300: '#CDA872',
          400: '#C09060',
          500: '#A6784A',
          600: '#8A5E35',
          700: '#6B4A2E',
          800: '#4A3020',
          900: '#2A1A10',
        },
        // Steel blue — logo highlight, focus rings, dark-mode primary
        steel: '#6A97C4',
        // Priority semantic colors (Yorki-aligned)
        priority: {
          low:    '#B0BAD1',
          normal: '#6A97C4',
          high:   '#A6784A',
          urgent: '#e11d48',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
      },
      keyframes: {
        'slide-in-right': {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to:   { transform: 'translateX(0)',    opacity: '1' },
        },
        'slide-out-right': {
          from: { transform: 'translateX(0)',    opacity: '1' },
          to:   { transform: 'translateX(100%)', opacity: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        'card-drop': {
          '0%':   { transform: 'scale(1.03) rotate(1deg)', opacity: '0.8' },
          '100%': { transform: 'scale(1)    rotate(0deg)', opacity: '1' },
        },
      },
      animation: {
        'slide-in-right':  'slide-in-right 0.25s ease-out',
        'slide-out-right': 'slide-out-right 0.2s ease-in',
        'fade-in':   'fade-in 0.2s ease-out',
        'card-drop': 'card-drop 0.15s ease-out',
      },
    },
  },
  plugins: [],
}

export default config
