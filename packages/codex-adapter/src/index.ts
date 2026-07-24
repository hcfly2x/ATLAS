export interface CodexExecutionRequest {
  readonly taskId: string;
  readonly worktreePath: string;
  readonly specificationPath: string;
}

export interface CodexExecutionResult {
  readonly exitCode: number;
  readonly summary: string;
}

export interface CodexAdapter {
  execute(request: CodexExecutionRequest): Promise<CodexExecutionResult>;
}
