import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { useWidgetProps } from "../use-widget-props";

function App() {
  const containerRef = useRef(null);
  const props = useWidgetProps();

  useEffect(() => {
    // Get chart config from props (structuredContent is flattened into props)
    const chartConfig = props?.chartConfig;

    console.log('[Chart Widget] props:', props);
    console.log('[Chart Widget] chartConfig:', chartConfig);

    if (!chartConfig) {
      console.error('[Chart Widget] No chartConfig found in props');
      return;
    }

    // Load the owid script if not already loaded
    if (!document.querySelector('script[src="https://ourworldindata.org/assets/owid.mjs"]')) {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = 'https://ourworldindata.org/assets/owid.mjs';
      script.onload = () => {
        if (window.renderSingleGrapherOnGrapherPage) {
          window.renderSingleGrapherOnGrapherPage(
            chartConfig,
            "https://api.ourworldindata.org/v1/indicators/"
          );
        }
      };
      document.body.appendChild(script);
    } else if (window.renderSingleGrapherOnGrapherPage) {
      window.renderSingleGrapherOnGrapherPage(
        chartConfig,
        "https://api.ourworldindata.org/v1/indicators/"
      );
    }

    // Set admin cookie
    document.cookie = "isAdmin=true;max-age=31536000";
  }, [props]);

  return (
    <div>
      <link
        href="https://fonts.googleapis.com/css?family=Lato:300,400,400i,700,700i|Playfair+Display:400,700&display=swap"
        rel="stylesheet"
      />
      <link rel="stylesheet" href="https://ourworldindata.org/assets/owid.css" />
      <div className="StandaloneGrapherOrExplorerPage" ref={containerRef}>
        <main>
          <figure data-grapher-src></figure>
        </main>
      </div>
    </div>
  );
}

createRoot(document.getElementById("chart-widget-root")).render(<App />);
