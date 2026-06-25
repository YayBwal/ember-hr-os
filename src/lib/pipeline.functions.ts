import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const PARSE_PROMPT = `You are an expert technical recruiter. The user uploads a candidate's CV (PDF or DOCX) for the role: "{ROLE}".

Return STRICT JSON with this exact shape (no prose, no markdown fences):
{
  "full_name": string,
  "email": string | null,
  "skills": string[],                 // 5-12 most relevant skills/technologies
  "ai_match_score": number,           // 0-100 integer, how well the CV matches the role
  "summary": string,                  // 1 sentence on the candidate
  "next_action": string               // imperative next step e.g. "Schedule Technical Screening", "Request portfolio", "Reject - insufficient experience"
}

Score honestly. If the CV is empty or unreadable, return ai_match_score 0 and next_action "Reject - unreadable CV".`;

interface ParseInput {
  fileBase64: string;
  mime: string;
  filename: string;
  role: string;
}

interface ParsedCv {
  full_name: string;
  email: string | null;
  skills: string[];
  ai_match_score: number;
  summary: string;
  next_action: string;
  cv_storage_path: string | null;
}

function isParseInput(v: unknown): v is ParseInput {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.fileBase64 === "string" &&
    typeof o.mime === "string" &&
    typeof o.filename === "string" &&
    typeof o.role === "string" &&
    o.fileBase64.length > 0 &&
    o.role.length > 0
  );
}

export const parseCv = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    if (!isParseInput(data)) throw new Error("Invalid input");
    return data;
  })
  .handler(async ({ data }): Promise<ParsedCv> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const userPrompt = PARSE_PROMPT.replace("{ROLE}", data.role);

    // Strip any accidental data URL prefix the client may have left on the base64 payload.
    const cleanBase64 = data.fileBase64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
    if (cleanBase64.length < 100) {
      throw new Error("Uploaded file is empty or unreadable");
    }

    // Upload original PDF to storage so HR can view it later (best-effort).
    let cv_storage_path: string | null = null;
    if (data.mime === "application/pdf") {
      try {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { randomUUID } = await import("crypto");
        const path = `hr-upload/${randomUUID()}.pdf`;
        const bytes = Buffer.from(cleanBase64, "base64");
        const { error } = await supabaseAdmin.storage
          .from("candidate-cvs")
          .upload(path, bytes, { contentType: "application/pdf", upsert: false });
        if (!error) cv_storage_path = path;
      } catch (e) {
        console.error("cv storage upload failed", e);
      }
    }
    // ~20 MB base64 cap — Gemini rejects very large inline files.
    if (cleanBase64.length > 20 * 1024 * 1024) {
      throw new Error("File too large — please upload a CV under 15 MB");
    }

    // Gemini's file input only reliably supports PDFs and a few image/audio types.
    // DOCX/DOC are not accepted — ask the user to convert. TXT can be inlined as text.
    let content: unknown[];
    if (data.mime === "application/pdf") {
      content = [
        { type: "text", text: userPrompt },
        {
          type: "file",
          file: {
            filename: data.filename,
            file_data: `data:application/pdf;base64,${cleanBase64}`,
          },
        },
      ];
    } else if (data.mime === "text/plain") {
      let decoded = "";
      try {
        decoded = Buffer.from(cleanBase64, "base64").toString("utf-8");
      } catch {
        throw new Error("Could not read text file");
      }
      content = [
        { type: "text", text: `${userPrompt}\n\n--- CV TEXT ---\n${decoded.slice(0, 60000)}` },
      ];
    } else {
      throw new Error("Unsupported file type — please upload a PDF or TXT (convert DOCX to PDF first)");
    }


    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content }],
        response_format: { type: "json_object" },
      }),
    });


    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (res.status === 429) throw new Error("AI rate limit — please retry in a moment");
      if (res.status === 402) throw new Error("AI credits exhausted — add credits in workspace settings");
      if (/document has no pages|could not be processed|unsupported|invalid.*pdf/i.test(errText)) {
        throw new Error("This PDF couldn't be read (it may be scanned, image-only, or password-protected). Please upload a text-based PDF or a .txt file.");
      }
      throw new Error(`CV parse failed (${res.status}): ${errText.slice(0, 300)}`);
    }


    const json = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = json.choices?.[0]?.message?.content ?? "{}";

    let parsed: Partial<ParsedCv> = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }

    return {
      full_name: String(parsed.full_name ?? "Unknown candidate").slice(0, 120),
      email: parsed.email ? String(parsed.email).slice(0, 200) : null,
      skills: Array.isArray(parsed.skills) ? parsed.skills.slice(0, 12).map((s) => String(s)) : [],
      ai_match_score: Math.max(0, Math.min(100, Math.round(Number(parsed.ai_match_score ?? 0)))),
      summary: String(parsed.summary ?? ""),
      next_action: String(parsed.next_action ?? "Schedule initial screening"),
    };
  });

interface ScoreInput {
  full_name: string;
  email?: string | null;
  skills?: string[];
  role: string;
  notes?: string | null;
}

export const scoreManual = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const o = data as ScoreInput;
    if (!o?.full_name || !o?.role) throw new Error("full_name and role required");
    return o;
  })
  .handler(async ({ data }): Promise<{ ai_match_score: number; next_action: string }> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

    const prompt = `Score this candidate for the role "${data.role}" on 0-100 and give a one-line next action. Return JSON {"ai_match_score": number, "next_action": string}.\n\nCandidate: ${data.full_name}\nEmail: ${data.email ?? "n/a"}\nSkills: ${(data.skills ?? []).join(", ") || "none listed"}\nNotes: ${data.notes ?? "none"}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "vercel-ai-sdk",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Score failed (${res.status}): ${t.slice(0, 200)}`);
    }
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = j.choices?.[0]?.message?.content ?? "{}";
    let parsed: { ai_match_score?: number; next_action?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (m) parsed = JSON.parse(m[0]);
    }
    return {
      ai_match_score: Math.max(0, Math.min(100, Math.round(Number(parsed.ai_match_score ?? 50)))),
      next_action: String(parsed.next_action ?? "Schedule initial screening"),
    };
  });

// ===== Deep analysis & comparison =====

export interface DeepAnalysis {
  strengths: string[];
  gaps: string[];
  red_flags: string[];
  role_fit_reasoning: string;
  interview_questions: string[];
  recommended_decision: string;
}

async function callJson(apiKey: string, prompt: string, model = "google/gemini-2.5-pro"): Promise<unknown> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 429) throw new Error("AI rate limit — please retry shortly");
    if (res.status === 402) throw new Error("AI credits exhausted — add credits in workspace settings");
    throw new Error(`AI failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const text = j.choices?.[0]?.message?.content ?? "{}";
  try { return JSON.parse(text); } catch {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  }
}

export const analyzeCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const o = data as { candidate_id?: string };
    if (!o?.candidate_id) throw new Error("candidate_id required");
    return { candidate_id: o.candidate_id };
  })
  .handler(async ({ data, context }): Promise<DeepAnalysis> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = (context as any).supabase;
    const { data: c, error } = await sb
      .from("candidates")
      .select("full_name, email, role_applied, skills, notes, ai_match_score")
      .eq("id", data.candidate_id)
      .maybeSingle();
    if (error || !c) throw new Error(error?.message ?? "Candidate not found");

    const prompt = `You are an expert technical recruiter. Analyze this candidate for the role "${c.role_applied}".

Candidate: ${c.full_name}
Email: ${c.email ?? "n/a"}
Current AI match score: ${c.ai_match_score}%
Skills: ${(c.skills ?? []).join(", ") || "none listed"}
Notes / CV summary: ${c.notes ?? "none"}

Return STRICT JSON (no markdown):
{
  "strengths": string[],            // 3-5 concrete strengths
  "gaps": string[],                 // 2-4 honest gaps vs role
  "red_flags": string[],            // 0-3 risk items, empty array if none
  "role_fit_reasoning": string,     // 2-3 sentences on fit
  "interview_questions": string[],  // 5 targeted interview questions
  "recommended_decision": string    // "Advance to interview" | "Hire" | "Reject" | "Hold"
}`;

    const parsed = (await callJson(apiKey, prompt)) as Partial<DeepAnalysis>;
    return {
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths.slice(0, 8).map(String) : [],
      gaps: Array.isArray(parsed.gaps) ? parsed.gaps.slice(0, 8).map(String) : [],
      red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags.slice(0, 8).map(String) : [],
      role_fit_reasoning: String(parsed.role_fit_reasoning ?? ""),
      interview_questions: Array.isArray(parsed.interview_questions)
        ? parsed.interview_questions.slice(0, 8).map(String)
        : [],
      recommended_decision: String(parsed.recommended_decision ?? "Hold"),
    };
  });

export interface ComparisonRow {
  candidate_id: string;
  full_name: string;
  strengths: string[];
  gaps: string[];
  verdict: string;
}
export interface ComparisonResult {
  summary: string;
  rows: ComparisonRow[];
  winner: string;
}

export const compareCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => {
    const o = data as { ids?: string[] };
    if (!Array.isArray(o?.ids) || o.ids.length < 2 || o.ids.length > 4) {
      throw new Error("Pick 2 to 4 candidates to compare");
    }
    return { ids: o.ids };
  })
  .handler(async ({ data, context }): Promise<ComparisonResult> => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = (context as any).supabase;
    const { data: cands, error } = await sb
      .from("candidates")
      .select("id, full_name, role_applied, skills, notes, ai_match_score")
      .in("id", data.ids);
    if (error || !cands || cands.length === 0) throw new Error(error?.message ?? "No candidates");

    type Row = { id: string; full_name: string; role_applied: string; skills: string[] | null; notes: string | null; ai_match_score: number };
    const list = cands as Row[];
    const role = list[0].role_applied;

    const prompt = `You are an expert technical recruiter. Compare these ${list.length} candidates head-to-head for the role "${role}".

${list.map((c, i) => `Candidate ${i + 1}: ${c.full_name}
  Match: ${c.ai_match_score}%
  Skills: ${(c.skills ?? []).join(", ") || "none"}
  Notes: ${c.notes ?? "none"}`).join("\n\n")}

Return STRICT JSON (no markdown):
{
  "summary": string,                // 2-3 sentence overview of the comparison
  "rows": [
    { "candidate_id": "<full_name>", "strengths": string[], "gaps": string[], "verdict": string }
  ],
  "winner": string                  // full_name of the strongest candidate
}
Use the candidate's full_name as candidate_id.`;

    const parsed = (await callJson(apiKey, prompt)) as Partial<ComparisonResult>;
    const byName = new Map(list.map((c) => [c.full_name, c.id]));
    const rows: ComparisonRow[] = Array.isArray(parsed.rows)
      ? parsed.rows.map((r) => ({
          candidate_id: byName.get(String(r.candidate_id)) ?? String(r.candidate_id),
          full_name: String(r.candidate_id),
          strengths: Array.isArray(r.strengths) ? r.strengths.slice(0, 6).map(String) : [],
          gaps: Array.isArray(r.gaps) ? r.gaps.slice(0, 6).map(String) : [],
          verdict: String(r.verdict ?? ""),
        }))
      : [];
    return {
      summary: String(parsed.summary ?? ""),
      rows,
      winner: String(parsed.winner ?? rows[0]?.full_name ?? ""),
    };
  });

