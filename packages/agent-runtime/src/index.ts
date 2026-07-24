export interface AgentRequest {
  readonly agentId: string;
  readonly taskId: string;
  readonly prompt: string;
}

export interface AgentResponse {
  readonly output: unknown;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

export interface AgentRuntime {
  run(request: AgentRequest): Promise<AgentResponse>;
}
