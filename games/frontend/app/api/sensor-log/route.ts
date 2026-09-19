// Dev-only: lets browser-side sensor code print into the `npm run dev` terminal.
export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const { message } = (await request.json().catch(() => ({}))) as { message?: string };
  console.log(`[sensor] ${message ?? ""}`);
  return new Response(null, { status: 204 });
}
