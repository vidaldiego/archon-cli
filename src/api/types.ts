// Path: archon-cli/src/api/types.ts
// Shared API types

// Health & System
export interface HealthStatus {
  status: 'OK' | 'DEGRADED' | 'DOWN';
  version: string;
  database: boolean;
  vcenter: boolean;
  smtp: boolean;
  sshKeyLoaded: boolean;
  uptime: number;
}

// Dashboard
export interface DashboardStats {
  totalMachines: number;
  byStatus: Record<string, number>;
  byProvider: Record<string, number>;
  byEnv: Record<string, number>;
  topIssues: TopIssue[];
  // Legacy fields for compatibility
  healthyMachines?: number;
  warningMachines?: number;
  criticalMachines?: number;
  unreachableMachines?: number;
  totalServices?: number;
  pendingUpdates?: number;
  activeJobs?: number;
  byEnvironment?: Record<string, number>;
}

export interface TopIssue {
  machineId: string;
  machineName: string;
  service?: string | null;
  status: string;
  primaryReason?: string;
  reasons?: string[];
}

// Machines
export interface Machine {
  machineId: string;
  name: string;
  primaryIp?: string;
  provider: string;
  env?: string;
  environment?: string; // Alias
  powerState: string;
  healthStatus: string;
  health?: MachineHealth; // Legacy
  service?: string;
  serviceDisplayName?: string;
  identityId?: number;
  identityName?: string;
  isManaged?: boolean;
  vcenterName?: string;
  pendingUpdates?: number;
  securityUpdates?: number;
  newReleaseAvailable?: string;
  cpuCount?: number;
  memoryMb?: number;
  tags?: Record<string, string>;
  lastHealthCheck?: number;
  machineType?: string;
  isEsxiHost?: boolean;
  esxiVersion?: string;
  hostManufacturer?: string;
  hostModel?: string;
  inMaintenanceMode?: boolean;
  managementIp?: string;
  managementType?: string;
  bmcHealth?: string;
  physicalServerId?: string;
}

export interface MachineHealth {
  status: 'OK' | 'WARN' | 'CRIT' | 'UNKNOWN';
  reasons: string[];
  checkedAt?: number;
}

export interface MachineDetail extends Machine {
  vmUuid?: string;
  folder?: string;
  cluster?: string;
  datacenter?: string;
  guestOs?: string;
  diskGb?: number;
  healthHistory?: HealthHistoryEntry[];
}

export interface HealthHistoryEntry {
  status: string;
  reasons: string[];
  timestamp: number;
}

// Services
export interface Service {
  id: string;
  displayName: string;
  description?: string;
  icon?: string;
  type: ServiceType;
  members: ServiceMember[];
  healthSummary: ServiceHealthSummary;
  clusterStatus?: ClusterStatus;
  pendingUpdates?: number;
  knowledgeDocCount?: number;
}

export interface ServiceType {
  id: string;
  displayName: string;
  name?: string; // Legacy field
  icon?: string;
  description?: string;
  hasPlugin?: boolean;
  builtIn?: boolean;
}

export interface ServiceMember {
  machineId: string;
  name: string;
  primaryIp?: string;
  role?: string;
  roleMetadata?: Record<string, string>;
  sortOrder?: number;
  healthStatus: string;
  powerState?: string;
  lastHealthCheck?: number;
  dockerContainers?: unknown;
  pendingUpdates?: number;
}

export interface ServiceHealthSummary {
  totalCount: number;
  okCount: number;
  warnCount: number;
  critCount: number;
  overallStatus: string;
}

export interface ServiceHealth {
  status: 'OK' | 'WARN' | 'CRIT' | 'UNKNOWN';
  healthy: number;
  warning: number;
  critical: number;
  unknown: number;
  total: number;
}

export interface ClusterStatus {
  healthy: boolean;
  summary: string;
  details: Record<string, unknown>;
}

export interface PreUpdateCheck {
  safe: boolean;
  blockers: CheckMessage[];
  warnings: CheckMessage[];
  info: CheckMessage[];
  updatePlan: UpdatePlanItem[];
  clusterStatus?: ClusterStatus;
}

export interface CheckMessage {
  type: 'BLOCKER' | 'WARNING' | 'INFO';
  message: string;
}

export interface UpdatePlanItem {
  machineId: string;
  machineName: string;
  role?: string;
  updatePriority: number;
}

// Updates
export interface UpdateJob {
  id: string;
  service: string;
  serviceDisplayName?: string;
  status: UpdateJobStatus;
  machineOrder: string[];
  currentMachineIndex: number;
  progress: number;
  totalMachines: number;
  createdBy: number;
  createdByUsername?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  scheduledAt?: number;
  results: UpdateResult[];
}

export type UpdateJobStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface UpdateResult {
  machineId: string;
  machineName: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'SKIPPED';
  startedAt?: number;
  completedAt?: number;
  error?: string;
  packagesUpdated?: number;
}

export interface UpdateStep {
  id: string;
  jobId: string;
  machineId: string;
  stepNumber: number;
  stepId: string;
  stepName: string;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  output?: string;
  startedAt?: number;
  completedAt?: number;
  durationMs?: number;
}

export interface UpdatePreview {
  machineId: string;
  machineName: string;
  packages: PackageUpdate[];
  totalCount: number;
}

export interface PackageUpdate {
  name: string;
  currentVersion: string;
  newVersion: string;
  type: string;
}

// Auto-Update
export interface AutoUpdatePolicy {
  id: number;
  serviceId?: number;
  enabled: boolean;
  windowStartHour: number;
  windowEndHour: number;
  windowTimezone: string;
  notifyOnAutoStart: boolean;
  requirePreCheck: boolean;
  blockOnWarnings: boolean;
}

export interface AutoUpdateSchedule {
  jobId: string;
  serviceId: string;
  serviceName: string;
  serviceIcon?: string;
  scheduledAt: number;
  scheduledAtFormatted: string;
  timeUntil: string;
  machineCount: number;
  machines: { machineId: string; name: string }[];
  status: string;
}

export interface AutoUpdateRun {
  id: number;
  serviceId: number;
  serviceName: string;
  status: string;
  windowStart: number;
  windowEnd: number;
  startedAt?: number;
  completedAt?: number;
  jobId?: string;
  blockedReason?: string;
}

// Alerts
export interface Alert {
  id: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  category: string;
  title: string;
  message: string;
  machineId?: string;
  machineName?: string;
  serviceId?: string;
  serviceName?: string;
  acknowledged: boolean;
  acknowledgedAt?: number;
  acknowledgedBy?: string;
  resolved: boolean;
  resolvedAt?: number;
  createdAt: number;
}

// Users
export interface User {
  id: number;
  username: string;
  email?: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  createdAt: number;
  lastLogin?: number;
}

// Identities
export interface Identity {
  id: number;
  name: string;
  username: string;
  authType: 'PASSWORD' | 'SSH_KEY';
  isDefault: boolean;
  machineCount: number;
  createdAt: number;
}

// vCenters
export interface VCenter {
  id: number;
  name: string;
  url: string;
  username: string;
  enabled: boolean;
  lastSync?: number;
  machineCount: number;
}

// Jobs Dashboard
export interface JobStatistics {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  avgDurationMs: number;
  byService: Record<string, number>;
  byStatus: Record<string, number>;
}

export interface JobSummary {
  job: UpdateJob;
  service: { id: string; displayName: string };
  machines: {
    machineId: string;
    name: string;
    status: string;
    packagesUpdated?: number;
    durationMs?: number;
  }[];
}

// SSH Host Keys
export interface SshHostKey {
  id: number;
  machineId: string;
  machineName: string;
  keyType: string;
  fingerprint: string;
  trustedAt: number;
}

export interface SshHostKeyChange {
  id: number;
  machineId: string;
  machineName: string;
  oldFingerprint?: string;
  newFingerprint: string;
  changeType: 'NEW' | 'CHANGED';
  detectedAt: number;
}

// Knowledge Base
export interface KnowledgeDocument {
  id: number;
  slug: string;
  title: string;
  content: string;
  category: string;
  isGlobal: boolean;
  tags: string[];
  createdAt: number;
  updatedAt?: number;
}

// Settings
export interface SmtpConfig {
  host: string;
  port: number;
  username: string;
  fromEmail: string;
  fromName: string;
  useTls: boolean;
  configured: boolean;
}

export interface NotificationPreferences {
  healthAlerts: boolean;
  updateNotifications: boolean;
  digestEmails: boolean;
  digestFrequency: 'IMMEDIATE' | 'HOURLY' | 'DAILY';
}

// AI Auto-Approval
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type AIActionType = 'RESTART_SERVICE' | 'CLEAR_CACHE' | 'ROTATE_LOGS' | 'SCALE_RESOURCES' |
  'APPLY_UPDATE' | 'FAILOVER' | 'REPLICATION_FIX' | 'CUSTOM';
export type CircuitTargetType = 'GLOBAL' | 'MACHINE' | 'SERVICE';
export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';
export type ExecutionType = 'AUTO' | 'MANUAL';
export type ProposalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED' | 'FAILED' | 'EXPIRED';

export interface AutoApprovalPolicy {
  id: number;
  enabled: boolean;
  maxRiskLevel: RiskLevel;
  minConfidenceScore: number;
  allowedActionTypes: AIActionType[] | null;
  requireSimilarSuccess: boolean;
  minSimilarCount: number;
  cooldownMinutes: number;
  maxPerHour: number;
  notifyOnAutoApproval: boolean;
  notifyOnAutoExecution: boolean;
  updatedBy: number | null;
  updatedAt: number;
}

export interface AutoApprovalPolicyUpdate {
  enabled?: boolean;
  maxRiskLevel?: RiskLevel;
  minConfidenceScore?: number;
  allowedActionTypes?: AIActionType[] | null;
  requireSimilarSuccess?: boolean;
  minSimilarCount?: number;
  cooldownMinutes?: number;
  maxPerHour?: number;
  notifyOnAutoApproval?: boolean;
  notifyOnAutoExecution?: boolean;
}

export interface CircuitBreakerEntry {
  targetType: CircuitTargetType;
  targetId: string | null;
  state: CircuitState;
  failureCount: number;
  lastFailureAt: number | null;
  openedAt: number | null;
  halfOpenAt: number | null;
  recoveryAttempts: number;
  updatedAt: number;
}

export interface CircuitBreakerStatus {
  global: CircuitBreakerEntry | null;
  machines: CircuitBreakerEntry[];
  services: CircuitBreakerEntry[];
  openCount: number;
  totalCount: number;
}

export interface ExecutionLog {
  id: number;
  proposalId: string;
  executionType: ExecutionType;
  executedBy: string;
  startedAt: number;
  completedAt: number | null;
  durationMs: number | null;
  success: boolean | null;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  errorMessage: string | null;
}

export interface ExecutionLogsResponse {
  logs: ExecutionLog[];
  total: number;
}

export interface AutoApprovalStats {
  autoApprovedCount: number;
  autoExecutedCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgExecutionTimeMs: number;
  lastAutoApprovalAt: number | null;
  lastAutoExecutionAt: number | null;
  circuitBreakerOpenCount: number;
  cooldownActiveCount: number;
}

export interface AIActionProposal {
  id: string;
  machineId: string | null;
  machineName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  actionType: AIActionType;
  actionTitle: string;
  actionDescription: string;
  command: string | null;
  riskLevel: RiskLevel;
  confidenceScore: number;
  reasoning: string;
  status: ProposalStatus;
  autoApprovalEligible: boolean;
  ineligibilityReasons: string[] | null;
  createdAt: number;
  expiresAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
  executedAt: number | null;
}
