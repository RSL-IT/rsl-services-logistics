// app/routes/logistics.test.jsx
import { json } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import { logisticsDb } from "~/logistics-db.server";

export async function loader() {
  const shipments = await logisticsDb.tbl_shipment.findMany({
    take: 5,
    orderBy: { id: "desc" },
  });

  return json({
    count: shipments.length,
    shipments,
  });
}

export default function LogisticsTest() {
  const data = useLoaderData();
  return <pre>{JSON.stringify(data, null, 2)}</pre>;
}
