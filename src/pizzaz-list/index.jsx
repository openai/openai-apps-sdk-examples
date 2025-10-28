import React, { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";

function App() {
  const containerRef = useRef(null);

  useEffect(() => {
    const chartConfig = {
      "id": 2994,
      "map": {
        "time": 2025,
        "colorScale": {
          "baseColorScheme": "OrRd",
          "binningStrategy": "manual",
          "customNumericColors": [null, null, null, null, null, null, null, null, null],
          "customNumericValues": [0, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000]
        },
        "columnSlug": "147859",
        "timeTolerance": 10
      },
      "tab": "map",
      "slug": "population-density",
      "title": "Population density",
      "yAxis": {"min": 0},
      "$schema": "https://files.ourworldindata.org/schemas/grapher-schema.009.json",
      "version": 50,
      "subtitle": "The number of people per km² of land area",
      "hasMapTab": true,
      "originUrl": "/population-growth",
      "dimensions": [
        {
          "display": {
            "includeInTable": true,
            "numDecimalPlaces": 1
          },
          "property": "y",
          "variableId": 953906
        }
      ],
      "isPublished": true,
      "relatedQuestions": [
        {
          "url": "https://ourworldindata.org/population-sources",
          "text": "What sources do we rely on for historical and future population estimates?"
        }
      ],
      "selectedEntityNames": ["World"],
      "hideAnnotationFieldsInTitle": {
        "time": true,
        "entity": true,
        "changeInPrefix": true
      },
      "bakedGrapherURL": "https://ourworldindata.org/grapher",
      "adminBaseUrl": "https://ourworldindata.org",
      "dataApiUrl": "https://api.ourworldindata.org/v1/indicators/"
    };

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
  }, []);

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

createRoot(document.getElementById("pizzaz-list-root")).render(<App />);
