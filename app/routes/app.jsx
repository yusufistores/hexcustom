import { json } from "@remix-run/node";
import { useState } from "react";
import { parse } from "csv-parse/sync";
import { authenticate } from "../shopify.server";


//==========================
//Graph Function
//=======================
async function parseGraphQL(res) {
  try {
    // try normal json
    if (typeof res.json === "function") {
      return await res.json();
    }

    // fallback (Shopify sometimes returns plain object)
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
// ✅ ACTION (SERVER)
// =========================
export async function action({ request }) {
  try {
    const { admin } = await authenticate.admin(request);

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      return json({ error: "No file uploaded" });
    }

    const buffer = await file.arrayBuffer();
    const text = new TextDecoder().decode(buffer);

    const records = parse(text, {
      columns: true,
      skip_empty_lines: true,
    });

    const results = [];
    const seen = new Set();

    for (const row of records) {
      const type = safe(row["Metaobject: Type"]);
      const label = safe(row["Label"]);
      const handle = safe(row["Metaobject: Handle"]);
      const color = safe(row["Color"]);
      const baseColor = safe(row["Base color"]);
      const basePattern = safe(row["Base pattern"]);

      // ❌ Required check
      if (!type || !label || !handle || !color) {
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
        // 🔍 Check existing
        const check = await admin.graphql(
          `query ($handle: String!, $type: String!) {
            metaobject(handle: $handle, type: $type) {
              id
            }
          }`,
          { variables: { handle, type } }
        );

        const checkJson = await parseGraphQL(check);

        if (!checkJson || !checkJson.data) {
            results.push({
              handle,
              status: "❌ GraphQL failed (check query or permissions)"
            });
            continue;
          }

        if (checkJson?.data?.metaobject) {
          results.push({ handle, status: "⚠️ Already exists" });
          continue;
        }

        // ✅ Create
        const create = await admin.graphql(
          `mutation (
            $type: String!,
            $handle: String!,
            $label: String!,
            $color: String!,
            $baseColor: String!,
            $basePattern: String!
          ) {
            metaobjectCreate(
              metaobject: {
                type: $type
                handle: $handle
                fields: [
                  { key: "label", value: $label }
                  { key: "color", value: $color }
                  { key: "base_color", value: $baseColor }
                  { key: "base_pattern", value: $basePattern }
                ]
              }
            ) {
              metaobject { id }
              userErrors { message }
            }
          }`,
          {
            variables: {
              type,
              handle,
              label,
              color,
              baseColor,
              basePattern,
            },
          }
        );

        const createJson = await create.json();

        if (createJson?.data?.metaobjectCreate?.userErrors?.length) {
          results.push({
            handle,
            status:
              "❌ " +
              createJson.data.metaobjectCreate.userErrors[0].message,
          });
        } else {
          results.push({ handle, status: "✅ Created" });
        }
      } catch (err) {
        console.error("ROW ERROR:", err);
        results.push({ handle, status: "❌ Failed" });
      }
    }

    return json({ results });
  } catch (err) {
    console.error("ACTION ERROR:", err);
    return json({ error: "Server crashed" });
  }
}

// =========================
// ✅ FRONTEND
// =========================
export default function App() {
  const [results, setResults] = useState([]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    const formData = new FormData(e.target);

    // 🔥 CRITICAL FIX FOR SHOPIFY EMBEDDED
    const res = await fetch("/app", {
  method: "POST",
  body: formData,
});

const raw = await res.text(); // ✅ read ONCE

let data;

try {
  data = JSON.parse(raw); // ✅ parse manually
} catch (err) {
  console.error("NOT JSON RESPONSE:", raw);
  alert("Server error — check terminal");
  return;
}
    if (data.results) {
      setResults(data.results);
    } else {
      alert(data.error || "Something went wrong");
    }
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>HexCustom Importer 🚀</h1>

      <form method="post" encType="multipart/form-data">
      <input type="file" name="file" required />
      <br /><br />
      <button type="submit">Import Colors</button>
     </form>
      <hr />

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