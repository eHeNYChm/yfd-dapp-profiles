// Shared artwork for the generated app icons: an anvil-orange "50" on near-black.
export function IconArt({ size }: { size: number }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#141311",
        color: "#e8702a",
        fontSize: size * 0.46,
        fontWeight: 800,
        letterSpacing: -size * 0.02,
        fontFamily: "sans-serif",
      }}
    >
      50
    </div>
  );
}
