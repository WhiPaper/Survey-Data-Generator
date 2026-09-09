export const createJobRegistry = ({ development = false }: { development?: boolean } = {}) => {
  const jobs = new Map<
    string,
    {
      controller: AbortController;
      onCancel?: () => void;
    }
  >();

  return {
    start(id: string, onCancel?: () => void): AbortSignal {
      if (jobs.has(id)) throw new Error(`Job already exists: ${id}`);
      const controller = new AbortController();
      jobs.set(id, { controller, onCancel });
      if (development) console.info("job_started", { id });
      return controller.signal;
    },

    finish(id: string): void {
      jobs.delete(id);
      if (development) console.info("job_finished", { id });
    },

    cancel(id: string): boolean {
      const job = jobs.get(id);
      if (!job) return false;
      job.controller.abort();
      try {
        job.onCancel?.();
      } finally {
        jobs.delete(id);
        if (development) console.info("job_cancelled", { id });
      }
      return true;
    },

    has(id: string): boolean {
      return jobs.has(id);
    },
  };
};

export type JobRegistry = ReturnType<typeof createJobRegistry>;
