import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { useMaxHeight } from "../use-max-height";
import { useOpenAiGlobal } from "../use-openai-global";

const DEFAULT_VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

function VideoPlayer() {
  const src = useMemo(() => {
    const v = typeof window !== "undefined" ? window.__PIZZAZ_VIDEO_URL__ : undefined;
    return typeof v === "string" && v.trim() ? v : DEFAULT_VIDEO;
  }, []);

  const maxHeight = useMaxHeight() ?? undefined;
  const displayMode = useOpenAiGlobal("displayMode");
  const containerHeight = typeof maxHeight === "number" && displayMode === "fullscreen"
    ? Math.max(0, maxHeight - 40) // match spacing pattern used elsewhere
    : 480; // sane default for inline mode

  return (
    <div
      className="relative w-full border border-black/10 dark:border-white/10 rounded-2xl sm:rounded-3xl overflow-hidden bg-black"
      style={{ maxHeight, height: containerHeight }}
    >
      <video
        style={{ display: "block", width: "100%", height: "100%", objectFit: "cover" }}
        src={src}
        autoPlay
        muted
        loop
        playsInline
        controls
      />
    </div>
  );
}

export default function App() {
  return <VideoPlayer />;
}

// Mount to the standard root expected by the dev server and widget HTML
const mountEl = document.getElementById("pizzaz-video-root");
if (mountEl) {
  createRoot(mountEl).render(<App />);
}
