import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ============ Employees (directory) ============
export const listFeedbackEmployees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("employees")
      .select("id, full_name, department, position, employee_code, phone_number, telegram_chat_id, email")
      .order("full_name");
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const upsertEmployeeDirectory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    id?: string;
    full_name: string;
    department: string;
    employee_code: string;
    phone_number?: string;
    position?: string;
  }) => d)
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("org_id").eq("id", context.userId).maybeSingle();
    const org_id = prof?.org_id;
    if (!org_id) throw new Error("No organization");

    if (data.id) {
      const { error } = await context.supabase
        .from("employees")
        .update({
          full_name: data.full_name,
          // department is an enum in existing schema; cast at DB level
          department: data.department as never,
          employee_code: data.employee_code,
          phone_number: data.phone_number ?? null,
          position: data.position ?? "Staff",
        })
        .eq("id", data.id);
      if (error) throw new Error(error.message);
      return { id: data.id };
    }
    const { data: ins, error } = await context.supabase
      .from("employees")
      .insert({
        org_id,
        full_name: data.full_name,
        department: data.department as never,
        employee_code: data.employee_code,
        phone_number: data.phone_number ?? null,
        position: data.position ?? "Staff",
        monthly_base_mmk: 0,
        level: "junior" as never,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: ins.id };
  });

// ============ Surveys ============
export const listSurveys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("surveys")
      .select("id, title, description, status, created_at, survey_questions(id, question_text, question_type, sort_order)")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createSurvey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    title: string;
    description?: string;
    questions: { question_text: string; question_type: "rating" | "multiple_choice" | "text" }[];
  }) => d)
  .handler(async ({ data, context }) => {
    const { data: prof } = await context.supabase.from("profiles").select("org_id").eq("id", context.userId).maybeSingle();
    const org_id = prof?.org_id;
    if (!org_id) throw new Error("No organization");
    const { data: s, error } = await context.supabase
      .from("surveys")
      .insert({ org_id, title: data.title, description: data.description ?? null, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    if (data.questions.length) {
      const rows = data.questions.map((q, i) => ({
        survey_id: s.id,
        question_text: q.question_text,
        question_type: q.question_type,
        sort_order: i,
      }));
      const { error: qe } = await context.supabase.from("survey_questions").insert(rows);
      if (qe) throw new Error(qe.message);
    }
    return { id: s.id };
  });

export const setSurveyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: "draft" | "active" | "completed" }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("surveys").update({ status: data.status }).eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteSurvey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("surveys").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ============ Telegram broadcast ============
export const broadcastSurveyToTelegram = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { surveyId: string }) => d)
  .handler(async ({ data, context }) => {
    const { tgSendMessage } = await import("./telegram.server");
    const { data: survey, error: sErr } = await context.supabase
      .from("surveys")
      .select("id, title, description, status")
      .eq("id", data.surveyId)
      .single();
    if (sErr || !survey) throw new Error(sErr?.message ?? "Survey not found");
    if (survey.status !== "active") {
      await context.supabase.from("surveys").update({ status: "active" }).eq("id", survey.id);
    }
    const { data: emps, error: eErr } = await context.supabase
      .from("employees")
      .select("id, full_name, telegram_chat_id")
      .not("telegram_chat_id", "is", null);
    if (eErr) throw new Error(eErr.message);

    let sent = 0;
    let failed = 0;
    for (const e of emps ?? []) {
      try {
        await tgSendMessage(
          e.telegram_chat_id as unknown as number,
          `<b>📋 New Survey: ${survey.title}</b>\n${survey.description ?? ""}\n\nReply <b>📋 Take Survey</b> to start.`,
        );
        sent++;
      } catch {
        failed++;
      }
    }
    return { sent, failed, total: (emps ?? []).length };
  });

// ============ Analytics & responses ============
export const listResponses = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { surveyId?: string }) => d)
  .handler(async ({ data, context }) => {
    let q = context.supabase
      .from("feedback_responses")
      .select("id, survey_id, question_id, department, rating_value, text_comment, submitted_at")
      .order("submitted_at", { ascending: false })
      .limit(1000);
    if (data.surveyId) q = q.eq("survey_id", data.surveyId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

// ============ Incident reports ============
export const listIncidentReports = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("employee_incident_reports")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const updateIncidentStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { id: string; status: "new" | "reviewing" | "resolved" | "dismissed" }) => d)
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("employee_incident_reports")
      .update({ status: data.status })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
