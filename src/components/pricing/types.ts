/** Minimal plan limits needed by pricing UI components. */
export interface PlanLimitFields {
  max_projects: number;
  max_tracked_keywords: number;
  max_competitors: number;
  max_keyword_groups: number;
  audit_daily_limit: number;
  audit_max_depth: number;
  serpapi_monthly_limit: number;
  serpapi_daily_limit: number;
  dataforseo_monthly_limit: number;
  content_check_monthly_limit: number;
  can_export_pdf: boolean;
  can_export_excel: boolean;
  can_email_report: boolean;
}

/** A single feature row in the comparison matrix. */
export interface ComparisonRow {
  /** i18n key under plans.features.* for the feature label */
  key: string;
  /** Extract a display value from plan limit fields. Return empty string to show "—". */
  getValue: (p: PlanLimitFields) => string;
}

/** Feature group heading with rows. */
export interface ComparisonGroup {
  /** i18n key under pricing.groups.* for the group title */
  groupKey: string;
  rows: ComparisonRow[];
}

/** Display info for a single pricing card (3 member plans). */
export interface PlanDisplay {
  plan: "free" | "lite" | "pro";
  name: string;
  tagline: string;
  price: string;
  priceUnit: string;
  ctaLabel: string;
  checkoutPlan?: "lite" | "pro";
  ctaHref?: string;
  highlighted?: boolean;
}

/** Feature bullet shown inside a pricing card. */
export interface CardFeature {
  text: string;
  included: boolean;
}
