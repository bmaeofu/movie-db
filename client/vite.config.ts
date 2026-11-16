import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Die Filmdatenbank laeuft unter dem Rahmen der Hauptanwendung (/movie-db/), damit
// Poster und Skripte relativ dazu aufgeloest werden.
export default defineConfig({
  base: "/movie-db/",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
      "/media": "http://localhost:3000",
    },
  },
});
