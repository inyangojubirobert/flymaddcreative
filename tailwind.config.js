/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // One Dream Initiative brand colors
        'onedream': {
          primary: '#004AAD',
          accent: '#FFD700',
          background: '#FFFFFF',
          50: '#E6F3FF',
          100: '#CCE7FF',
          200: '#99CFFF',
          300: '#66B7FF',
          400: '#339FFF',
          500: '#0087FF',
          600: '#004AAD',
          700: '#003A8A',
          800: '#002A67',
          900: '#001A44',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'bounce-slow': 'bounce 2s ease-in-out infinite',
      },
      backgroundImage: {
        'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
        'gradient-conic':
          'conic-gradient(from 180deg at 50% 50%, var(--tw-gradient-stops))',
      },
    },
  },
  plugins: [
    // Add form plugin for better form styling
    require('@tailwindcss/forms'),
  ],
  safelist: [
    // Ensure these classes are never purged
    'text-blue-600',
    'text-green-600',
    'text-yellow-600',
    'text-purple-600',
    'bg-blue-50',
    'bg-green-50',
    'bg-yellow-50',
    'bg-purple-50',
    'border-blue-300',
    'border-green-300',
    'border-yellow-300',
    'border-purple-300',
  ]
}