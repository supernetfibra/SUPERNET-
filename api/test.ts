export default async function handler(request: Request): Promise<Response> {
  return new Response(JSON.stringify({ ok: true, time: Date.now() }), {
    headers: { "Content-Type": "application/json" },
  });
}
