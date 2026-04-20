import React from "react";
import { useWidgetProps } from "../use-widget-props";
import { useWidgetState } from "../use-widget-state";
import { useDisplayMode } from "../use-display-mode";
import { useEffect } from "react";

const ExpandIcon = () => {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M4.33496 11C4.33496 10.6327 4.63273 10.335 5 10.335C5.36727 10.335 5.66504 10.6327 5.66504 11V14.335H9L9.13379 14.3486C9.43692 14.4106 9.66504 14.6786 9.66504 15C9.66504 15.3214 9.43692 15.5894 9.13379 15.6514L9 15.665H5C4.63273 15.665 4.33496 15.3673 4.33496 15V11ZM14.335 9V5.66504H11C10.6327 5.66504 10.335 5.36727 10.335 5C10.335 4.63273 10.6327 4.33496 11 4.33496H15L15.1338 4.34863C15.4369 4.41057 15.665 4.67857 15.665 5V9C15.665 9.36727 15.3673 9.66504 15 9.66504C14.6327 9.66504 14.335 9.36727 14.335 9Z" />
    </svg>
  );
};

export function App() {
  const widgetProps = useWidgetProps() || {};
  const { title_text = 'hi' } = widgetProps;
  const displayMode = useDisplayMode();
  const maxHeight = "100vh";

  const [titleText, setTitleText] = useWidgetState(title_text);
  const [isLoading, setIsLoading] = useWidgetState(false);

  useEffect(() => {
    setTitleText(title_text);
  }, [title_text, setTitleText]);

  const helloAgain = async () => {
    //await window.openai.sendFollowUpMessage({ "prompt": "can you show the test app again with the title 'hello again.'" });
    setIsLoading(true);
    try {
      const reply = await window.openai.callTool("test-tool", {
        "title_text": "hi again. :)"
      });
      if (reply?.structuredContent?.title_text) {
        setTitleText(reply.structuredContent.title_text);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const gotoDoc = () => {
    window.openai.openExternal({ href: "https://developers.openai.com/apps-sdk" });
  };

  return (
    <div
      className={`antialiased w-full relative bg-blue-300 overflow-hidden ${displayMode !== "fullscreen" ? "aspect-[640/480] sm:aspect-[640/400]" : ""
        }`}
      style={{
        maxHeight,
        height: displayMode === "fullscreen" ? maxHeight : undefined,
      }}
    >
      {displayMode !== "fullscreen" && (
        <div className="fixed end-3 z-20 top-3 aspect-square rounded-full p-2 bg-white/20 text-white backdrop-blur-lg">
          <button
            onClick={() => {
              window.openai.requestDisplayMode({ mode: "fullscreen" });
            }}
          >
            <ExpandIcon />
          </button>
        </div>
      )}

      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        padding: '16px',
        fontSize: '18px',
        fontWeight: 'bold'
      }}>
        <div>{titleText || 'hi'}</div>
        <button
          onClick={helloAgain}
          disabled={isLoading}
          style={{
            marginTop: '10px',
            padding: '8px 16px',
            fontSize: '14px',
            backgroundColor: 'green',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isLoading ? 'wait' : 'pointer'
          }}
        >
          {isLoading ? 'Loading...' : 'Say hello again'}
        </button>
        <button
          onClick={gotoDoc}
          style={{
            marginTop: '10px',
            marginLeft: '10px',
            padding: '8px 16px',
            fontSize: '14px',
            cursor: 'pointer',
            backgroundColor: 'green',
            color: 'white',
            border: 'none',
            borderRadius: '4px'
          }}
        >
          Go to Apps SDK doc
        </button>
      </div>
    </div>
  );
}

export default App;