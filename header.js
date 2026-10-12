
(() => {
  const script = document.currentScript;

  if (!script || !script.src) {
    console.error("Shared header: could not locate header.js.");
    return;
  }

  const baseUrl = new URL("./", script.src);
  const headerUrl = new URL("header.html", baseUrl);
  const cssUrl = new URL("header.css", baseUrl);

  if (!document.querySelector('[data-shared-header-css]')) {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = cssUrl.href;
    stylesheet.dataset.sharedHeaderCss = "true";
    document.head.appendChild(stylesheet);
  }

  async function loadHeader() {
    const target = document.getElementById("site-header");

    if (!target) {
      console.error(
        'Shared header: add <div id="site-header"></div> to the page.'
      );
      return;
    }

    try {
      const response = await fetch(headerUrl.href);

      if (!response.ok) {
        throw new Error(`Could not load header.html (${response.status})`);
      }

      target.innerHTML = await response.text();

      target.querySelectorAll("[data-route]").forEach((link) => {
        const route = link.dataset.route;
        link.href = new URL(route, baseUrl).href;
      });

      document.dispatchEvent(new CustomEvent("shared-header-loaded"));
    } catch (error) {
      console.error("Shared header failed to load:", error);
      target.textContent = "The site header couldn't load. Please refresh.";
    }
  }

  loadHeader();
})();
