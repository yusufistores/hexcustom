import { Outlet, useRouteError } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export async function loader({ request }) {
  await authenticate.admin(request);
  return null;
}

export default function App() {
  return (
    <AppProvider>
      <ui-nav-menu>
        <a href="/app" rel="home">
          Home
        </a>
        <a href="/app/additional">Additional page</a>
      </ui-nav-menu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
