import { Link, Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData();

  return (
    <AppProvider isEmbeddedApp apiKey={apiKey}>
      <ui-nav-menu>
        <Link to="/app" rel="home">
          Home
        </Link>
      </ui-nav-menu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs headers to handle boundaries
export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};

export function ErrorBoundary() {
  const error = useRouteError();

  // Shopify's default boundary.error() breaks in production because Vite minifies 
  // the ErrorResponse class name, making error.constructor.name === 'ErrorResponse' fail.
  // Instead, we check the error status and data directly, or use isRouteErrorResponse.
  if (
    error &&
    typeof error === "object" &&
    "status" in error &&
    error.status === 200 &&
    typeof error.data === "string" &&
    error.data.includes("shopifycloud/app-bridge.js")
  ) {
    return (
      <div
        dangerouslySetInnerHTML={{
          __html: error.data,
        }}
      />
    );
  }

  return boundary.error(error);
}
