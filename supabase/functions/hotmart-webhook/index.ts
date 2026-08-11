import "jsr:@supabase/functions-js/edge-runtime.d.ts";

Deno.serve(() => new Response(
  "Endpoint descontinuado. Configure /api/webhooks/hotmart/{connectionId} na Central Genesis.",
  { status: 410 },
));
