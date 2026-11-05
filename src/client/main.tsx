import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// iOS Safari は、触れたときの :active（押した瞬間に沈む。0059）を、文書に touchstart の手当てがあるときだけ付ける
document.addEventListener("touchstart", () => {}, { passive: true });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
