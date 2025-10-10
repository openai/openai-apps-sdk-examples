import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

/**
 * Choice Widget
 * ---------------
 * This React component renders a multiple-choice question.
 * It supports:
 *  - Hydration from window.openai.toolOutput (new MCP protocol)
 *  - Fallback hydration from postMessage (legacy mode)
 *  - Sending the selected choice back to ChatGPT
 *  - Automatic re-render on first injection (no refresh needed)
 */
function App() {
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState([]);
  const [loading, setLoading] = useState(true);

  // 🧠 Hydrate from window.openai.toolOutput (new ChatGPT clients)
  useEffect(() => {
    function hydrate() {
      if (window.openai?.toolOutput) {
        const sc = window.openai.toolOutput;
        setQuestion(sc?.question || "");
        setChoices(sc?.choices || []);
        setLoading(false);
        return true;
      }
      return false;
    }

    // Try once immediately
    if (!hydrate()) {
      // If data not yet injected, poll until available
      const interval = setInterval(() => {
        if (hydrate()) clearInterval(interval);
      }, 200);
      return () => clearInterval(interval);
    }
  }, []);

  // 📬 Fallback hydration via postMessage (for legacy widget transport)
  useEffect(() => {
    const handleMsg = (event) => {
      const sc = event.data?.structuredContent;
      if (sc) {
        setQuestion(sc.question || "");
        setChoices(sc.choices || []);
        setLoading(false);
      }
    };
    window.addEventListener("message", handleMsg);
    return () => window.removeEventListener("message", handleMsg);
  }, []);

  // 🪄 Send result back to ChatGPT
  const handleChoice = async (opt) => {
    if (window.openai?.sendFollowUpMessage) {
      await window.openai.sendFollowUpMessage({ prompt: String(opt) });
    } else {
      window.parent.postMessage({ structuredContent: { choice: String(opt) } }, "*");
    }
  };

  // 💅 UI Layout (Tailwind-like styling)
  return (
    <div className="antialiased w-full text-black px-4 pb-2 border border-black/10 rounded-2xl sm:rounded-3xl overflow-hidden bg-white shadow-sm max-w-md mx-auto">
      <div className="max-w-full">
        <div className="flex flex-col gap-2 py-4">
          <div className="text-lg sm:text-xl font-medium mb-2">
            {loading ? "Loading question..." : question}
          </div>

          {loading ? (
            <div className="text-sm text-gray-500">Waiting for data...</div>
          ) : choices.length > 0 ? (
            <div className="flex flex-col space-y-2">
              {choices.map((opt) => (
                <button
                  key={opt}
                  onClick={() => handleChoice(opt)}
                  type="button"
                  className="cursor-pointer text-left block w-full border border-gray-300 rounded-lg px-4 py-2 text-base bg-gray-50 hover:bg-gray-100 active:bg-gray-200 transition"
                >
                  {opt}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500">No options available.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 🧩 React entrypoint
 * Using Pizzaz-style createRoot syntax
 * 
 * We wait for DOMContentLoaded to ensure the #choice-root element
 * is ready (prevents "must refresh once" bug in ChatGPT iframe).
 */
document.addEventListener("DOMContentLoaded", () => {
  const rootEl = document.getElementById("choice-root");
  if (rootEl) {
    createRoot(rootEl).render(<App />);
  } else {
    console.error("[choice-widget] Root element #choice-root not found.");
  }
});
