import type { CreateTaskInput, CreateTaskResult, TaskCoreStore } from "@atlas/core";

export interface TaskIntakeOptions {
  readonly onTaskCreated?: (taskId: string, correlationId: string) => void;
  readonly taskStore: TaskCoreStore;
}

export class TaskIntakeService {
  constructor(private readonly options: TaskIntakeOptions) {}

  async create(input: CreateTaskInput): Promise<CreateTaskResult> {
    const result = await this.options.taskStore.createTask(input);
    if (!result.idempotentReplay) {
      this.notifyTaskCreated(result.task.id, input.correlationId);
    }
    return result;
  }

  notifyTaskCreated(taskId: string, correlationId: string): void {
    this.options.onTaskCreated?.(taskId, correlationId);
  }
}
