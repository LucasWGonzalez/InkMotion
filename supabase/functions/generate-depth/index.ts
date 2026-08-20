import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL_VERSION = "b239ea33cff32bb7abb5db39ffe9a09c14cbc2894331d1ef66fe096eed88ebd4";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) throw new Error("Sesión de autor no disponible.");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const replicateToken = Deno.env.get("REPLICATE_API_TOKEN");
    if (!replicateToken) throw new Error("REPLICATE_API_TOKEN no está configurado.");

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) throw new Error("La sesión de autor no es válida.");

    const { storyId } = await req.json();
    if (!/^[0-9a-f-]{36}$/i.test(storyId || "")) throw new Error("Proyecto inválido.");
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: story, error: storyError } = await admin.from("stories")
      .select("id,author_id,image_path,config").eq("id", storyId).single();
    if (storyError || !story) throw new Error("No se encontró la obra.");
    if (story.author_id !== user.id) throw new Error("No tenés permiso para modificar esta obra.");

    const imageUrl = admin.storage.from("stories").getPublicUrl(story.image_path).data.publicUrl;
    const predictionResponse = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${replicateToken}`,
        "Content-Type": "application/json",
        "Prefer": "wait=30",
      },
      body: JSON.stringify({ version: MODEL_VERSION, input: { image: imageUrl } }),
    });
    let prediction = await predictionResponse.json();
    if (!predictionResponse.ok) throw new Error(prediction?.detail || "Replicate rechazó la generación.");

    for (let attempt = 0; !["succeeded", "failed", "canceled"].includes(prediction.status) && attempt < 25; attempt++) {
      await sleep(1000);
      const poll = await fetch(prediction.urls.get, { headers: { "Authorization": `Bearer ${replicateToken}` } });
      prediction = await poll.json();
    }
    if (prediction.status !== "succeeded") throw new Error(prediction.error || "El mapa de profundidad no terminó a tiempo.");
    const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (typeof outputUrl !== "string") throw new Error("Replicate devolvió un resultado inesperado.");

    const depthResponse = await fetch(outputUrl);
    if (!depthResponse.ok) throw new Error("No se pudo descargar el mapa generado.");
    const depthBlob = await depthResponse.blob();
    const depthPath = `${user.id}/${story.id}/depth.png`;
    const { error: uploadError } = await admin.storage.from("stories").upload(depthPath, depthBlob, {
      contentType: depthBlob.type || "image/webp", cacheControl: "31536000", upsert: true,
    });
    if (uploadError) throw uploadError;

    const config = { ...(story.config || {}), depthPath, depthModel: "depth-anything-v2", depthStatus: "ready" };
    const { error: updateError } = await admin.from("stories").update({ config }).eq("id", story.id);
    if (updateError) throw updateError;
    return Response.json({ depthPath, status: "ready" }, { headers: { ...corsHeaders, "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[InkMotion/generate-depth]", error);
    return Response.json({ error: error instanceof Error ? error.message : "Error generando profundidad." }, {
      status: 400, headers: { ...corsHeaders, "Cache-Control": "no-store" },
    });
  }
});
