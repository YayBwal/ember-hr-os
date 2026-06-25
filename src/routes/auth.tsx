import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ArrowLeft, Loader2 } from "lucide-react";
import { z } from "zod";

export const Route = createFileRoute("/auth")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Sign in · Mandai" },
      { name: "description", content: "Sign in to your Mandai workspace." },
    ],
  }),
  component: AuthPage,
});

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
  password: z.string().min(6, "Min 6 characters").max(128),
});

const resetSchema = z.object({
  email: z.string().trim().email("Enter a valid email").max(255),
});

function AuthPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (data.user) navigate({ to: "/operations" });
      if (error) supabase.auth.signOut({ scope: "local" });
    });
  }, [navigate]);

  async function handleSignIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const parsed = signInSchema.safeParse({
      email: form.get("email"),
      password: form.get("password"),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword(parsed.data);
    if (error) {
      setLoading(false);
      toast.error(
        error.message === "Invalid login credentials"
          ? "Invalid email or password."
          : error.message,
      );
      return;
    }

    const { error: userError } = await supabase.auth.getUser();
    setLoading(false);
    if (userError) {
      await supabase.auth.signOut({ scope: "local" });
      toast.error("This saved session is no longer valid. Please sign in again.");
      return;
    }

    toast.success("Welcome back");
    navigate({ to: "/operations" });
  }

  async function handlePasswordReset(email: FormDataEntryValue | null) {
    const parsed = resetSchema.safeParse({ email });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Password reset email sent");
  }

  return (
    <div className="relative grid min-h-screen md:grid-cols-2">
      {/* left visual */}
      <div className="relative hidden overflow-hidden border-r border-border bg-card md:block">
        <div className="absolute inset-0 grid-bg opacity-30" />
        <div className="relative flex h-full flex-col justify-between p-10">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
          <div className="max-w-md">
            <div className="text-xs font-mono uppercase tracking-[0.2em] text-primary">Mandai</div>
            <h1 className="mt-4 font-display text-4xl font-semibold leading-tight tracking-tight">
              AI Operations Layer for Enterprise HR.
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Recruitment, operations, delivery and MMK payroll — unified in one real-time workspace.
            </p>
          </div>
          <div className="text-xs font-mono text-muted-foreground">v0.1 · Live workspace</div>
        </div>
      </div>

      {/* form */}
      <div className="flex items-center justify-center bg-background p-6 md:p-10">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-6 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground md:hidden">
            <ArrowLeft className="h-3 w-3" /> Back
          </Link>
          <h2 className="font-display text-2xl font-semibold tracking-tight">Welcome back</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your Mandai workspace.</p>

          <form onSubmit={handleSignIn} className="mt-6 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="si-email">Email</Label>
              <Input id="si-email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="si-password">Password</Label>
              <Input id="si-password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                onClick={(event) => {
                  const form = event.currentTarget.form;
                  handlePasswordReset(form ? new FormData(form).get("email") : null);
                }}
                disabled={loading}
              >
                Forgot password?
              </button>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Accounts are created by your administrator.
          </p>
        </div>
      </div>
    </div>
  );
}
