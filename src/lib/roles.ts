// Shared list of recruitable roles. Used by both the Pipeline UI
// and the Telegram /apply flow so candidates pick the same positions
// HR sees in the screening tab.
export const ROLE_PRESETS = [
  "Software Engineer",
  "Senior Engineer",
  "Product Manager",
  "Designer",
  "Operations Analyst",
  "Finance Analyst",
  "HR Specialist",
  "Customer Success",
] as const;

export type RolePreset = (typeof ROLE_PRESETS)[number];
