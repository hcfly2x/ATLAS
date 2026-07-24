export interface WorktreeRequest {
  readonly repositoryPath: string;
  readonly branchName: string;
  readonly worktreePath: string;
}

export interface GitAdapter {
  createWorktree(request: WorktreeRequest): Promise<void>;
  removeWorktree(worktreePath: string): Promise<void>;
}
