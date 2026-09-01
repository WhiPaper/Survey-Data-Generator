import { useEffect, useState } from "react";

import { pingBackend } from "./api/backend";

type ConnectionState =
  | { status: "connecting" }
  | { status: "connected"; message: string }
  | { status: "failed"; message: string };

export function App() {
  const [connection, setConnection] = useState<ConnectionState>({ status: "connecting" });

  useEffect(() => {
    let active = true;
    void pingBackend().then(
      (result) => {
        if (active) setConnection({ status: "connected", message: result.message });
      },
      (error: unknown) => {
        if (active && error instanceof Error)
          setConnection({ status: "failed", message: error.message });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <main>
      <h1>App</h1>
      <p>
        {connection.status === "connecting" && "Connecting…"}
        {connection.status === "connected" && `Backend connected: ${connection.message}`}
        {connection.status === "failed" && `Backend unavailable: ${connection.message}`}
      </p>
    </main>
  );
}
