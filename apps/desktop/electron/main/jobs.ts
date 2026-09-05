export const createJobRegistry = () => {
  const jobs = new Map<string, AbortController>();

  return {
    start(id: string): AbortSignal {
      if (jobs.has(id)) throw new Error(`Job already exists: ${id}`);
      const controller = new AbortController();
      jobs.set(id, controller);
      return controller.signal;
    },

    finish(id: string): void {
      jobs.delete(id);
    },

    cancel(id: string): boolean {
      const controller = jobs.get(id);
      if (!controller) return false;
      controller.abort();
      jobs.delete(id);
      return true;
    },

    has(id: string): boolean {
      return jobs.has(id);
    },
  };
};

export type JobRegistry = ReturnType<typeof createJobRegistry>;
