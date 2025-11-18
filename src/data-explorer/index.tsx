import { createRoot } from "react-dom/client";
import { App } from "./App";

const rootElement = document.getElementById("data-explorer-root");

if (rootElement) {
  const root = createRoot(rootElement);
  root.render(<App />);
}

export { App };
export default App;
