import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { installTracker } from "./lib/tracker";

installTracker();

createRoot(document.getElementById("root")!).render(<App />);
