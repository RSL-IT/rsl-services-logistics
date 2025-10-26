// app/routes/health.js
export const loader = () =>
  new Response("ok", {
    status: 200,
    headers: {
      "content-type": "text/plain",
      "cache-control": "no-store",
    },
  });
