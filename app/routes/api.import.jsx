export async function action({ request }) {
  try {
    const body = await request.json();
    const { data } = body;

    if (!data) {
      return new Response(
        JSON.stringify({ error: "No data received" }),
        { status: 400 }
      );
    }

    const results = data.map((row) => ({
      name: row.name,
      hex: row.hex,
      status: "Imported",
    }));

    return new Response(
      JSON.stringify({ success: true, results }),
      {
        headers: { "Content-Type": "application/json" },
      }
    );

  } catch (err) {
    console.error(err);

    return new Response(
      JSON.stringify({ error: "Server error" }),
      { status: 500 }
    );
  }
}