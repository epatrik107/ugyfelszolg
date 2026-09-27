import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router-dom";
import App from "./App";
export { seoRoutes, notFoundSeo } from "./seo/routes";
export { buildHeadTags, siteUrl, isProductionSite } from "./seo/head";
export function render(url: string) {
  return renderToString(<StaticRouter location={url}><App /></StaticRouter>);
}
