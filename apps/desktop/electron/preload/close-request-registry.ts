export type BeforeCloseListener = () => boolean | Promise<boolean>;

export const createBeforeCloseRegistry = () => {
  let listener: BeforeCloseListener | null = null;

  const setListener = (next: BeforeCloseListener): (() => void) => {
    listener = next;
    return () => {
      if (listener === next) listener = null;
    };
  };

  const resolve = async (): Promise<boolean> => {
    const current = listener;
    if (!current) return true;
    try {
      return (await current()) === true;
    } catch {
      return false;
    }
  };

  return { setListener, resolve } as const;
};
