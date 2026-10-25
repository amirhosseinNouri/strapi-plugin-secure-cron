export type AdminUserSummary = {
  id: number;
  documentId?: string;
  firstname: string | null;
  lastname: string | null;
  username: string | null;
  email: string | null;
};

export type CronJob = {
  id: number;
  documentId: string;
  name: string;
  schedule: string;
  script: string;
  iterationsLimit: number;
  iterationsCount: number;
  startDate: string;
  endDate: string;
  latestExecutionLog: string[][];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  locale: string | null;
  publicationDate: string | null;
  createdBy?: AdminUserSummary | null;
  updatedBy?: AdminUserSummary | null;
};

export type CronJobInputData = Pick<
  CronJob,
  'name' | 'schedule' | 'script' | 'iterationsLimit' | 'startDate' | 'endDate'
>;

export type CronJobInputErrors = { [K in keyof CronJobInputData]?: string | string[] };

export type SecuritySeverity = 'error' | 'warning';

export type SecurityFinding = {
  ruleId: string;
  severity: SecuritySeverity;
  message: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
};

export type SecurityCheckResult = {
  enabled: boolean;
  passed: boolean;
  errors: number;
  warnings: number;
  findings: SecurityFinding[];
};

/** A problem found by the project's publishGuard, e.g. content the job would break. */
export type ContentFinding = {
  severity: SecuritySeverity;
  message: string;
  /** Admin-panel path where the problem can be fixed, e.g. a Content Manager entry. */
  link?: string;
};

/**
 * Project-specific check run before a cron job is turned on or test-run. Return
 * findings; any `error` keeps the job off. A thrown error counts as a failure.
 */
export type PublishGuard = (args: {
  strapi: unknown;
  cronJob: CronJob;
}) => ContentFinding[] | Promise<ContentFinding[]>;

export type PluginSettings = {
  securityCheck: boolean;
  syntaxHighlighting: boolean;
};

export type TriggerResult = {
  success: boolean;
  logs: string[][];
  error?: string;
  /** publishGuard warnings for this run; they did not block it. */
  contentWarnings?: ContentFinding[];
};

/** A published cron job, plus any publishGuard warnings that did not block publishing. */
export type PublishResult = CronJob & { contentWarnings?: ContentFinding[] };
