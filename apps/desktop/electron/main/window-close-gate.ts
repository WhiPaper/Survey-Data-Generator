export type WindowCloseDecision = "allow" | "prevent" | "prevent_and_request";

export const createWindowCloseGate = () => {
  let rendererApproved = false;
  let requestPending = false;

  return {
    requestClose(): WindowCloseDecision {
      if (rendererApproved) {
        rendererApproved = false;
        return "allow";
      }
      if (requestPending) return "prevent";
      requestPending = true;
      return "prevent_and_request";
    },
    resolve(canClose: boolean): boolean {
      requestPending = false;
      if (!canClose) return false;
      rendererApproved = true;
      return true;
    },
  } as const;
};
