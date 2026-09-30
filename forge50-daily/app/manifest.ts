import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Forge 50 Daily",
    short_name: "Forge 50",
    description: "Today’s training, recommendation, calendar and tasks.",
    start_url: "/",
    display: "standalone",
    background_color: "#141311",
    theme_color: "#141311",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
