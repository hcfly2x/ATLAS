export interface QueueHealth {
  readonly adapter: "pg-boss";
  readonly connected: boolean;
}

export interface QueueAdapter {
  health(): Promise<QueueHealth>;
}

export const queueAdapterName = "pg-boss" as const;
