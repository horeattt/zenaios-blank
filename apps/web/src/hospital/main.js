import { boot } from "./ui.js";

boot().catch((err) => {
  console.error(err);
  const bar = document.createElement("div");
  bar.style.cssText = "position:sticky;top:0;z-index:50;background:#a4262c;color:#fff;padding:8px 16px;font:13px Segoe UI,sans-serif";
  bar.textContent = err instanceof Error ? err.message : "Nu s-a putut porni dashboard-ul.";
  document.body.prepend(bar);
});
