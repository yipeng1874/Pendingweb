import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        feishu: {
          blue: "#4F8DFF",
          deep: "#245BDB",
          pale: "#EFF4FF",
        },
      },
      boxShadow: {
        card: "0 16px 40px rgba(31, 35, 41, 0.08)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
