import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { buildHeadTags } from "./head";
import { routeForPath } from "./routes";
export function useRouteHead() {
  const { pathname } = useLocation();
  useEffect(() => {
    const template = document.createElement("template");
    template.innerHTML = buildHeadTags(routeForPath(pathname));
    document.head.querySelectorAll("[data-route-head]").forEach((node) => node.remove());
    document.head.append(template.content);
  }, [pathname]);
}
