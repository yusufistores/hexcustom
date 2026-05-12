import { data } from "react-router";
import { Form, useActionData, useNavigation } from "react-router";
import { parse } from "csv-parse/sync";
import { authenticate } from "../shopify.server";


//==========================
// GraphQL Response Parser
//=======================
async function parseGraphQL(res) {
  try {
    // Shopify's admin.graphql() returns a Response-like object with .json()
    // but it does NOT pass instanceof Response. Always try .json() first.
    if (res && typeof res.json === 'function') {
      return await res.json();
    }
    // If it's already a parsed object, return it
    if (typeof res === 'object' && res !== null) {
      return res;
    }
    return res;
  } catch (err) {
    console.error("GRAPHQL PARSE ERROR:", err);
    return null;
  }
}

// =========================
// ✅ SAFE HELPER
// =========================
function safe(val) {
  if (val === undefined || val === null) return "";
  return String(val).trim();
}

// =========================
// ✅ Ensure metaobject definition exists
// =========================
async function ensureDefinition(admin, rawType) {
  const targetType = "shopify--color-pattern";

  if (!rawType || rawType.startsWith("app--")) {
    rawType = targetType;
  }

  // Strip any leading namespace:
  //   "shopify--color-pattern"        → "shopify--color-pattern"
  //   "app--351620202497--color-pattern" → "color-pattern"
  const baseType = rawType
    .replace(/^app--[^-]+--/, ''); // remove app--ID-- prefix
  console.log(`Looking for metaobject definition: raw="${rawType}", base="${baseType}"`);

  // 1) Try finding by the raw CSV type first
  for (const tryType of [rawType, baseType]) {
    try {
      const res = await admin.graphql(
        `query ($type: String!) {
          metaobjectDefinitionByType(type: $type) {
            type
            name
          }
        }`,
        { variables: { type: tryType } }
      );
      const json = await parseGraphQL(res);
      if (json?.data?.metaobjectDefinitionByType) {
        const actualType = json.data.metaobjectDefinitionByType.type;
        console.log(`✅ Found existing definition: ${actualType}`);
        return actualType;
      }
    } catch (e) {
      console.log(`Definition lookup for "${tryType}" failed:`, e.message);
    }
  }

  // 2) Definition doesn't exist → create it
  console.log(`Creating new metaobject definition: "${baseType}"`);
  try {
    const res = await admin.graphql(
      `mutation ($definition: MetaobjectDefinitionCreateInput!) {
        metaobjectDefinitionCreate(definition: $definition) {
          metaobjectDefinition {
            type
            name
          }
          userErrors { message field }
        }
      }`,
      {
        variables: {
          definition: {
            type: baseType,
            name: "Color Pattern",
            access: {
              storefront: "PUBLIC_READ"
            },
            fieldDefinitions: [
              { key: "label", name: "Label", type: "single_line_text_field" },
              { key: "color", name: "Color", type: "color" },
              { key: "base_color", name: "Base Color", type: "single_line_text_field" },
              { key: "base_pattern", name: "Base Pattern", type: "single_line_text_field" }
            ]
          }
        }
      }
    );
    const json = await parseGraphQL(res);

    if (json?.data?.metaobjectDefinitionCreate?.userErrors?.length) {
      const errors = json.data.metaobjectDefinitionCreate.userErrors;
      console.error("Definition creation userErrors:", JSON.stringify(errors));
      return null;
    }

    if (!json?.data?.metaobjectDefinitionCreate?.metaobjectDefinition) {
      console.error("Definition creation returned no definition. Full response:", JSON.stringify(json));
      return null;
    }

    const actualType = json.data.metaobjectDefinitionCreate.metaobjectDefinition.type;
    console.log(`✅ Created definition: ${actualType}`);
    return actualType;
  } catch (e) {
    console.error("Definition creation failed:", e.message);
  }

  return null;
}

// =========================
// ✅ ACTION (SERVER)
// =========================
export async function action({ request }) {
  // authenticate.admin() may THROW a Response (redirect to OAuth).
  // We must let thrown Responses propagate — do NOT catch them.
  const { admin } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return data({ error: "No file uploaded" });
    }

    const buffer = await file.arrayBuffer();
    const text = new TextDecoder().decode(buffer);

    const records = parse(text, {
      columns: true,
      skip_empty_lines: true,
    });

    if (records.length === 0) {
      return data({ error: "CSV is empty" });
    }

    // ── Step 1: Ensure the metaobject definition exists ──
    const csvType = safe(records[0]["Metaobject: Type"]);
    const actualType = await ensureDefinition(admin, csvType);

    if (!actualType) {
      return data({
        error: `Could not find or create metaobject definition for type "${csvType}". Check your Shopify app permissions (read_metaobjects, write_metaobjects).`
      });
    }

    // ── Step 2: Import rows ──
    const results = [];
    const seen = new Set();

    for (const row of records) {
      const label = safe(row["Label"]);
      const handle = safe(row["Metaobject: Handle"]);
      const color = safe(row["Color"]);
      const baseColor = safe(row["Base color"]);
      const basePattern = safe(row["Base pattern"]);

      // ❌ Required check
      if (!label || !handle || !color) {
        results.push({ handle: handle || "N/A", status: "❌ Missing data" });
        continue;
      }

      // ⚠️ Duplicate CSV
      if (seen.has(handle)) {
        results.push({ handle, status: "⚠️ Duplicate in CSV" });
        continue;
      }

      seen.add(handle);

      try {
        // 🔍 Check if entry already exists
        const check = await admin.graphql(
          `query ($handle: MetaobjectHandleInput!) {
            metaobjectByHandle(handle: $handle) {
              id
            }
          }`,
          { variables: { handle: { type: actualType, handle } } }
        );

        const checkJson = await parseGraphQL(check);

        if (!checkJson || !checkJson.data) {
          console.error("CHECK QUERY FAILED:", JSON.stringify(checkJson));
          results.push({
            handle,
            status: "❌ GraphQL check failed"
          });
          continue;
        }

        if (checkJson.data.metaobjectByHandle) {
          results.push({ handle, status: "⚠️ Already exists" });
          continue;
        }

        // ✅ Create the metaobject entry
        const create = await admin.graphql(
          `mutation ($metaobject: MetaobjectCreateInput!) {
            metaobjectCreate(metaobject: $metaobject) {
              metaobject { id handle }
              userErrors { message field }
            }
          }`,
          {
            variables: {
              metaobject: {
                type: actualType,
                handle,
                fields: [
                  { key: "label", value: label },
                  { key: "color", value: color },
                  { key: "base_color", value: baseColor },
                  { key: "base_pattern", value: basePattern },
                ],
              },
            },
          }
        );

        const createJson = await parseGraphQL(create);

        if (createJson?.data?.metaobjectCreate?.userErrors?.length) {
          const errMsg = createJson.data.metaobjectCreate.userErrors
            .map(e => e.message)
            .join(", ");
          results.push({ handle, status: "❌ " + errMsg });
        } else {
          results.push({ handle, status: "✅ Created" });
        }
      } catch (err) {
        const msg = err?.message || String(err);
        console.error("ROW ERROR for", handle, ":", msg);
        results.push({ handle, status: "❌ " + msg });
      }
    }

    return data({ results, definitionType: actualType });
  } catch (err) {
    console.error("ACTION ERROR:", err);
    return data({ error: "Server error: " + (err?.message || String(err)) });
  }
}

// =========================
// ✅ FRONTEND
// =========================
export default function App() {
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const results = actionData?.results || [];

  return (
    <div style={{ padding: 20 }}>
      <h1>HexCustom Importer 🚀</h1>

      <Form method="post" encType="multipart/form-data">
        <input type="file" name="file" accept=".csv" required />
        <br /><br />
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Importing..." : "Import Colors"}
        </button>
      </Form>
      <hr />

      {actionData?.error && (
        <p style={{ color: "red" }}>⚠️ {actionData.error}</p>
      )}

      {actionData?.definitionType && (
        <p style={{ color: "green" }}>
          📦 Using metaobject type: <code>{actionData.definitionType}</code>
        </p>
      )}

      <h2>Results</h2>

      {results.length === 0 ? (
        <p>No results yet</p>
      ) : (
        <ul>
          {results.map((r, i) => (
            <li key={i}>
              <strong>{r.handle}</strong> → {r.status}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
