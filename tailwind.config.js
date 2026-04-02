/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{html,js,jsx,ts,tsx}",
    "./node_modules/flowbite/**/*.js",
    "./node_modules/flowbite-react/**/*.js",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: "var(--ds-color-bg)",
          surface: "var(--ds-color-surface)",
          "surface-alt": "var(--ds-color-surface-alt)",
          text: "var(--ds-color-text)",
          "text-strong": "var(--ds-color-text-strong)",
          accent: "var(--ds-color-accent)",
          border: "var(--ds-color-border)",
          danger: "var(--ds-color-danger)",
        },
      },
      fontFamily: {
        display: ['"Perfectly Nineties"', "serif"],
        body: ['"IBM Plex Sans"', "sans-serif"],
        ui: ['"PP Neue Montreal"', '"IBM Plex Sans"', "sans-serif"],
      },
      borderRadius: {
        "brand-xs": "var(--radius-xs)",
        "brand-sm": "var(--radius-sm)",
        "brand-lg": "var(--radius)",
        "brand-pill": "var(--radius-pill)",
      },
      boxShadow: {
        "brand-sm": "var(--ds-shadow-sm)",
        "brand-md": "var(--ds-shadow-md)",
      },
      transitionDuration: {
        fast: "var(--ds-duration-fast)",
        normal: "var(--ds-duration-normal)",
      },
      transitionTimingFunction: {
        standard: "var(--ds-ease-standard)",
      },
    },
  },
  plugins: [require("flowbite/plugin")],
};
