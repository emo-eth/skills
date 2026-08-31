export const BOTS_CONFIG_VERSION = 1;

export type BotScope = "user" | "project";
export type BotMemoryScope = BotScope | "off";
export type BotContextMode = "fresh" | "fork";
export type BotThinking = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | false;
export type DomainRecordKind = "observation" | "inference" | "verified";

export interface BotDefinition {
  name: string;
  runtimeName: string;
  title: string;
  description: string;
  domains: string[];
  instructions?: string;
  model?: string;
  fallbackModels: string[];
  thinking?: BotThinking;
  tools?: string[];
  skills?: string[];
  delegates: string[];
  memory: BotMemoryScope;
  context: BotContextMode;
  timeoutMs: number;
  maxSubagentDepth: number;
  enabled: boolean;
  scope: BotScope;
  configPath: string;
}

export interface BotRoster {
  version: 1;
  bots: BotDefinition[];
  domainOwners: Record<string, string>;
  sharedInstructions?: string;
  sources: string[];
  projectRoot: string;
  agentDir: string;
  agentProjectRoot?: string;
}

export interface ConfigCandidate {
  path: string;
  content: string;
  scope: BotScope;
  precedence: number;
}

export interface DomainRecordInput {
  domain: string;
  kind: DomainRecordKind;
  summary: string;
  evidence?: string;
}

export interface MemoryRecordInput {
  summary: string;
}

export interface BotStateSnapshot {
  bot?: BotDefinition;
  memory?: string;
  domains: Array<{
    domain: string;
    owner: string;
    path: string;
    content: string;
    truncated: boolean;
  }>;
}

export interface RuntimeAgentDefinition {
  description: string;
  systemPrompt: string;
  tools?: readonly string[];
  allowNestedSubagents?: boolean;
  mutationTools?: readonly string[];
  model?: string;
  fallbackModels?: readonly string[];
  thinking?: string | false;
  systemPromptMode?: "append" | "replace";
  inheritProjectContext?: boolean;
  inheritGlobalContext?: boolean;
  inheritSkills?: boolean;
  defaultContext?: BotContextMode;
  defaultAsync?: boolean;
  defaultTimeoutMs?: number;
  acceptanceRole?: "read-only" | "writer";
  skills?: readonly string[];
  subagentOnlyExtensions?: readonly string[];
  maxSubagentDepth?: number;
  completionGuard?: boolean;
}
