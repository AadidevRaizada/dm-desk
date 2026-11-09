import { ImageResponse } from "next/og";

// Link-preview card for DM Desk (paper + ink, red accent triangle).
export const alt = "DM Desk: your Instagram DMs, stats and hooks in one place";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "#f6f3ec",
          color: "#1b1b1f",
          border: "14px solid #1b1b1f",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 36 }}>
          <svg width="140" height="124" viewBox="0 0 140 124">
            <polygon points="70,6 134,118 6,118" fill="#e0402a" stroke="#1b1b1f" strokeWidth="8" strokeLinejoin="round" />
            <line x1="44" y1="62" x2="96" y2="62" stroke="#f6f3ec" strokeWidth="8" />
            <line x1="30" y1="90" x2="110" y2="90" stroke="#f6f3ec" strokeWidth="8" />
          </svg>
          <div style={{ fontSize: 150, fontWeight: 800, letterSpacing: -4 }}>DM Desk</div>
        </div>
        <div style={{ fontSize: 46, marginTop: 30, color: "#4a4a52" }}>
          Your Instagram DMs, stats and hooks in one place.
        </div>
      </div>
    ),
    size
  );
}
