/**
 * Accessible client-side hash router with focus management.
 */

export class Router {
  constructor(routes, defaultRoute = "overview") {
    this.routes = routes;
    this.defaultRoute = defaultRoute;
    this.currentRoute = null;

    window.addEventListener("hashchange", () => this.handleRoute());
  }

  init() {
    this.handleRoute();
  }

  navigate(route) {
    window.location.hash = `#${route}`;
  }

  handleRoute() {
    const hash = window.location.hash.slice(1).trim();
    const route = this.routes[hash] ? hash : this.defaultRoute;

    if (this.currentRoute === route) {
      return;
    }

    this.currentRoute = route;

    // Update nav links
    document.querySelectorAll(".nav-link").forEach(link => {
      const target = link.getAttribute("href")?.slice(1);
      if (target === route) {
        link.classList.add("active");
        link.setAttribute("aria-current", "page");
      } else {
        link.classList.remove("active");
        link.removeAttribute("aria-current");
      }
    });

    // Mount page view
    const viewContainer = document.getElementById("view-root");
    if (viewContainer && this.routes[route]) {
      viewContainer.innerHTML = "";
      this.routes[route](viewContainer);
      
      // Accessibility focus management
      viewContainer.setAttribute("tabindex", "-1");
      viewContainer.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: "instant" });
    }
  }
}
