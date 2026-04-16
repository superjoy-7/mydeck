import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Primary palette from user's reference
        'baby-powder': '#F8FBF9',
        'jordy-blue': '#9EBEED',
        'chefchaouen': '#4E90F5',
        'apple-green': '#94C000',
        'dark-moss': '#4B6B03',
        // Semantic colors
        'primary': '#4E90F5',
        'primary-light': '#E8F1FD',
        'primary-dark': '#3A7BD5',
        'accent': '#94C000',
        'accent-light': '#EDF5CC',
        'surface': '#F8FBF9',
        'surface-elevated': '#FFFFFF',
        'text-primary': '#1a2e1a',
        'text-secondary': '#5a6b5a',
        'text-muted': '#8a9b8a',
        'border': '#e8f0e8',
        'border-light': '#f0f5f0',
        'danger': '#DC2626',
        'danger-light': '#FEF2F2',
      },
      boxShadow: {
        "card": "0 2px 8px 0 rgba(0, 0, 0, 0.05)",
        "card-hover": "0 8px 24px 0 rgba(0, 0, 0, 0.10)",
        "soft": "0 2px 12px 0 rgba(78, 144, 245, 0.08)",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
    },
  },
  plugins: [],
};
export default config;