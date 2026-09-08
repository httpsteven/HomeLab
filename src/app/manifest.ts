import type { MetadataRoute } from "next";

/**
 * Web app manifest.
 *
 * Makes "Add to Home Screen" produce a real app icon that opens fullscreen,
 * without Safari's chrome eating a chunk of an already-narrow phone layout.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Home Lab",
    short_name: "Home Lab",
    description:
      "Plex, Sonarr, Radarr, Bazarr, Tautulli and server health in one place.",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b0c",
    theme_color: "#0b0b0c",
    orientation: "portrait-primary",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      // Android crops to a circle; this one has the safe-zone padding baked in.
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
