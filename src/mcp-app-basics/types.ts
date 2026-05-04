export interface Step {
  id: number;
  title: string;
  summary: string;
  code?: string;
}

export interface DemoData {
  toolName: string;
  steps: Step[];
}
