export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attendance: {
        Row: {
          created_at: string
          date: string
          employee_id: string
          id: string
          minutes_late: number
          note: string | null
          status: Database["public"]["Enums"]["attendance_status"]
        }
        Insert: {
          created_at?: string
          date: string
          employee_id: string
          id?: string
          minutes_late?: number
          note?: string | null
          status: Database["public"]["Enums"]["attendance_status"]
        }
        Update: {
          created_at?: string
          date?: string
          employee_id?: string
          id?: string
          minutes_late?: number
          note?: string | null
          status?: Database["public"]["Enums"]["attendance_status"]
        }
        Relationships: [
          {
            foreignKeyName: "attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      bonuses: {
        Row: {
          amount_mmk: number
          created_at: string
          employee_id: string
          id: string
          period_month: string
          reason: string | null
          source: string
        }
        Insert: {
          amount_mmk?: number
          created_at?: string
          employee_id: string
          id?: string
          period_month: string
          reason?: string | null
          source?: string
        }
        Update: {
          amount_mmk?: number
          created_at?: string
          employee_id?: string
          id?: string
          period_month?: string
          reason?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "bonuses_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      candidates: {
        Row: {
          ai_match_score: number
          created_at: string
          email: string | null
          full_name: string
          id: string
          next_action: string | null
          notes: string | null
          org_id: string
          role_applied: string
          skills: string[]
          status: Database["public"]["Enums"]["candidate_status"]
          trainee_salary_mmk: number | null
          updated_at: string
        }
        Insert: {
          ai_match_score?: number
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          next_action?: string | null
          notes?: string | null
          org_id: string
          role_applied: string
          skills?: string[]
          status?: Database["public"]["Enums"]["candidate_status"]
          trainee_salary_mmk?: number | null
          updated_at?: string
        }
        Update: {
          ai_match_score?: number
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          next_action?: string | null
          notes?: string | null
          org_id?: string
          role_applied?: string
          skills?: string[]
          status?: Database["public"]["Enums"]["candidate_status"]
          trainee_salary_mmk?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "candidates_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      deductions: {
        Row: {
          amount_mmk: number
          created_at: string
          employee_id: string
          id: string
          period_month: string
          reason: string | null
          source: string
        }
        Insert: {
          amount_mmk?: number
          created_at?: string
          employee_id: string
          id?: string
          period_month: string
          reason?: string | null
          source?: string
        }
        Update: {
          amount_mmk?: number
          created_at?: string
          employee_id?: string
          id?: string
          period_month?: string
          reason?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "deductions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_kpis: {
        Row: {
          attendance: number
          employee_id: string
          id: string
          kpi: number
          period_month: string
          productivity: number
          quality: number
          task_completion: number
          updated_at: string
        }
        Insert: {
          attendance?: number
          employee_id: string
          id?: string
          kpi?: number
          period_month: string
          productivity?: number
          quality?: number
          task_completion?: number
          updated_at?: string
        }
        Update: {
          attendance?: number
          employee_id?: string
          id?: string
          kpi?: number
          period_month?: string
          productivity?: number
          quality?: number
          task_completion?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_kpis_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_promotions: {
        Row: {
          created_at: string
          created_by: string | null
          effective_date: string
          employee_id: string
          from_base_mmk: number | null
          from_level: Database["public"]["Enums"]["employee_level"] | null
          from_position: string | null
          id: string
          note: string | null
          org_id: string
          to_base_mmk: number
          to_level: Database["public"]["Enums"]["employee_level"]
          to_position: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          effective_date?: string
          employee_id: string
          from_base_mmk?: number | null
          from_level?: Database["public"]["Enums"]["employee_level"] | null
          from_position?: string | null
          id?: string
          note?: string | null
          org_id: string
          to_base_mmk: number
          to_level: Database["public"]["Enums"]["employee_level"]
          to_position: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          effective_date?: string
          employee_id?: string
          from_base_mmk?: number | null
          from_level?: Database["public"]["Enums"]["employee_level"] | null
          from_position?: string | null
          id?: string
          note?: string | null
          org_id?: string
          to_base_mmk?: number
          to_level?: Database["public"]["Enums"]["employee_level"]
          to_position?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_promotions_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_promotions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          attendance_pct: number
          avatar_url: string | null
          candidate_id: string | null
          created_at: string
          department: Database["public"]["Enums"]["department"]
          email: string | null
          full_name: string
          id: string
          join_date: string
          level: Database["public"]["Enums"]["employee_level"]
          monthly_base_mmk: number
          org_id: string
          performance_score: number
          phone: string | null
          position: string
          salary_grade: string | null
          team_id: string | null
          updated_at: string
          workload: number
        }
        Insert: {
          attendance_pct?: number
          avatar_url?: string | null
          candidate_id?: string | null
          created_at?: string
          department: Database["public"]["Enums"]["department"]
          email?: string | null
          full_name: string
          id?: string
          join_date?: string
          level?: Database["public"]["Enums"]["employee_level"]
          monthly_base_mmk?: number
          org_id: string
          performance_score?: number
          phone?: string | null
          position: string
          salary_grade?: string | null
          team_id?: string | null
          updated_at?: string
          workload?: number
        }
        Update: {
          attendance_pct?: number
          avatar_url?: string | null
          candidate_id?: string | null
          created_at?: string
          department?: Database["public"]["Enums"]["department"]
          email?: string | null
          full_name?: string
          id?: string
          join_date?: string
          level?: Database["public"]["Enums"]["employee_level"]
          monthly_base_mmk?: number
          org_id?: string
          performance_score?: number
          phone?: string | null
          position?: string
          salary_grade?: string | null
          team_id?: string | null
          updated_at?: string
          workload?: number
        }
        Relationships: [
          {
            foreignKeyName: "employees_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "candidates"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      meeting_summaries: {
        Row: {
          action_items: Json
          created_at: string
          deadlines: Json
          decisions: Json
          id: string
          key_points: Json
          meeting_id: string
          participants: Json
          risks: Json
          summary: string | null
        }
        Insert: {
          action_items?: Json
          created_at?: string
          deadlines?: Json
          decisions?: Json
          id?: string
          key_points?: Json
          meeting_id: string
          participants?: Json
          risks?: Json
          summary?: string | null
        }
        Update: {
          action_items?: Json
          created_at?: string
          deadlines?: Json
          decisions?: Json
          id?: string
          key_points?: Json
          meeting_id?: string
          participants?: Json
          risks?: Json
          summary?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meeting_summaries_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: true
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
        ]
      }
      meetings: {
        Row: {
          audio_path: string | null
          created_at: string
          id: string
          org_id: string
          status: Database["public"]["Enums"]["meeting_status"]
          title: string
          transcript: string | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          audio_path?: string | null
          created_at?: string
          id?: string
          org_id: string
          status?: Database["public"]["Enums"]["meeting_status"]
          title: string
          transcript?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          audio_path?: string | null
          created_at?: string
          id?: string
          org_id?: string
          status?: Database["public"]["Enums"]["meeting_status"]
          title?: string
          transcript?: string | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "meetings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          default_trainee_salary_mmk: number
          id: string
          name: string
          salary_bands: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_trainee_salary_mmk?: number
          id?: string
          name: string
          salary_bands?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_trainee_salary_mmk?: number
          id?: string
          name?: string
          salary_bands?: Json
          updated_at?: string
        }
        Relationships: []
      }
      payroll_lines: {
        Row: {
          base_mmk: number
          bonus_mmk: number
          created_at: string
          deduction_mmk: number
          employee_id: string
          id: string
          kpi_snapshot: number
          overtime_mmk: number
          performance_bonus_mmk: number
          run_id: string
          tasks_completed: number
          total_mmk: number
        }
        Insert: {
          base_mmk?: number
          bonus_mmk?: number
          created_at?: string
          deduction_mmk?: number
          employee_id: string
          id?: string
          kpi_snapshot?: number
          overtime_mmk?: number
          performance_bonus_mmk?: number
          run_id: string
          tasks_completed?: number
          total_mmk?: number
        }
        Update: {
          base_mmk?: number
          bonus_mmk?: number
          created_at?: string
          deduction_mmk?: number
          employee_id?: string
          id?: string
          kpi_snapshot?: number
          overtime_mmk?: number
          performance_bonus_mmk?: number
          run_id?: string
          tasks_completed?: number
          total_mmk?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_lines_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payroll_lines_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "payroll_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      payroll_runs: {
        Row: {
          created_at: string
          generated_at: string
          id: string
          org_id: string
          period_month: string
          total_mmk: number
        }
        Insert: {
          created_at?: string
          generated_at?: string
          id?: string
          org_id: string
          period_month: string
          total_mmk?: number
        }
        Update: {
          created_at?: string
          generated_at?: string
          id?: string
          org_id?: string
          period_month?: string
          total_mmk?: number
        }
        Relationships: [
          {
            foreignKeyName: "payroll_runs_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          org_id: string
          preferences: Json
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          org_id: string
          preferences?: Json
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          org_id?: string
          preferences?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "profiles_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      task_comments: {
        Row: {
          author_user_id: string | null
          body: string
          created_at: string
          id: string
          task_id: string
        }
        Insert: {
          author_user_id?: string | null
          body: string
          created_at?: string
          id?: string
          task_id: string
        }
        Update: {
          author_user_id?: string | null
          body?: string
          created_at?: string
          id?: string
          task_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "task_comments_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          assignee_employee_id: string | null
          completed_at: string | null
          created_at: string
          description: string | null
          due_date: string | null
          effort_points: number
          id: string
          meeting_id: string | null
          org_id: string
          position: number
          priority: Database["public"]["Enums"]["task_priority"]
          progress: number
          status: Database["public"]["Enums"]["task_status"]
          team_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          assignee_employee_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          effort_points?: number
          id?: string
          meeting_id?: string | null
          org_id: string
          position?: number
          priority?: Database["public"]["Enums"]["task_priority"]
          progress?: number
          status?: Database["public"]["Enums"]["task_status"]
          team_id?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          assignee_employee_id?: string | null
          completed_at?: string | null
          created_at?: string
          description?: string | null
          due_date?: string | null
          effort_points?: number
          id?: string
          meeting_id?: string | null
          org_id?: string
          position?: number
          priority?: Database["public"]["Enums"]["task_priority"]
          progress?: number
          status?: Database["public"]["Enums"]["task_status"]
          team_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tasks_assignee_employee_id_fkey"
            columns: ["assignee_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_meeting_id_fkey"
            columns: ["meeting_id"]
            isOneToOne: false
            referencedRelation: "meetings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      team_members: {
        Row: {
          created_at: string
          employee_id: string
          id: string
          team_id: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          id?: string
          team_id: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          id?: string
          team_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "team_members_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string
          department: Database["public"]["Enums"]["department"]
          id: string
          name: string
          org_id: string
          team_lead_employee_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          department: Database["public"]["Enums"]["department"]
          id?: string
          name: string
          org_id: string
          team_lead_employee_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          department?: Database["public"]["Enums"]["department"]
          id?: string
          name?: string
          org_id?: string
          team_lead_employee_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teams_lead_fk"
            columns: ["team_lead_employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teams_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_list_all_users: {
        Args: never
        Returns: {
          email: string
          full_name: string
          id: string
          org_id: string
          org_name: string
        }[]
      }
      admin_list_organizations: {
        Args: never
        Returns: {
          created_at: string
          id: string
          member_count: number
          name: string
        }[]
      }
      admin_set_user_org: {
        Args: { _org_id: string; _user_id: string }
        Returns: undefined
      }
      approve_candidate: {
        Args: {
          _candidate_id: string
          _department: Database["public"]["Enums"]["department"]
          _monthly_base: number
          _position: string
          _team_id?: string
        }
        Returns: string
      }
      create_and_switch_org: { Args: { _name: string }; Returns: string }
      current_org_id: { Args: never; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      promote_employee: {
        Args: {
          _effective_date?: string
          _employee_id: string
          _note?: string
          _to_base_mmk: number
          _to_level: Database["public"]["Enums"]["employee_level"]
          _to_position: string
        }
        Returns: string
      }
      recompute_employee_kpi: {
        Args: { _employee_id: string; _period: string }
        Returns: undefined
      }
      recompute_payroll: {
        Args: { _employee_id: string; _period: string }
        Returns: undefined
      }
      set_org_default_trainee_salary: {
        Args: { _amount: number }
        Returns: undefined
      }
      switch_my_org: { Args: { _org_id: string }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "recruiter" | "hr" | "finance" | "team_leader"
      attendance_status: "present" | "late" | "absent" | "leave"
      candidate_status:
        | "screening"
        | "interview"
        | "trainee"
        | "hired"
        | "rejected"
      department: "HR" | "Operations" | "Finance" | "Admin" | "Engineering"
      employee_level: "junior" | "mid" | "senior" | "lead"
      meeting_status:
        | "uploaded"
        | "transcribing"
        | "extracting"
        | "ready"
        | "failed"
      task_priority: "low" | "medium" | "high" | "urgent"
      task_status:
        | "todo"
        | "in_progress"
        | "review"
        | "done"
        | "blocked"
        | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "recruiter", "hr", "finance", "team_leader"],
      attendance_status: ["present", "late", "absent", "leave"],
      candidate_status: [
        "screening",
        "interview",
        "trainee",
        "hired",
        "rejected",
      ],
      department: ["HR", "Operations", "Finance", "Admin", "Engineering"],
      employee_level: ["junior", "mid", "senior", "lead"],
      meeting_status: [
        "uploaded",
        "transcribing",
        "extracting",
        "ready",
        "failed",
      ],
      task_priority: ["low", "medium", "high", "urgent"],
      task_status: [
        "todo",
        "in_progress",
        "review",
        "done",
        "blocked",
        "cancelled",
      ],
    },
  },
} as const
