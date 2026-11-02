/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "media",
  theme: {
    fontFamily: {
      sans: [
        "Avenir Next",
        "Roboto",
        "-apple-system",
        "BlinkMacSystemFont",
        '"Segoe UI"',
        "Ubuntu",
        '"Helvetica Neue"',
        "Arial",
        '"Noto Sans"',
        "sans-serif",
        '"Apple Color Emoji"',
        '"Segoe UI Emoji"',
        '"Segoe UI Symbol"',
        '"Noto Color Emoji"',
      ],
      mono: [
        "ui-monospace",
        "SFMono-Regular",
        "Menlo",
        "Monaco",
        "Consolas",
        "Liberation Mono",
        "Courier New",
        "monospace",
      ],
    },
  },
  plugins: [require("@tailwindcss/forms")],
  content: [
    `app/components/**/*.{vue,js}`,
    `app/layouts/**/*.vue`,
    `app/pages/**/*.vue`,
    `app/composables/**/*.{js,ts}`,
    `app/plugins/**/*.{js,ts}`,
    `app/App.{js,ts,vue}`,
    `app/app.{js,ts,vue}`,
  ],
};
