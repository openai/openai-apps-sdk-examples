import { createRoot } from "react-dom/client";
import App from "./test";

createRoot(document.getElementById("test-root")).render(<App />);

export { App };
export default App;
