import { useEffect, useState } from 'react';

export type LogType = 'info' | 'warn' | 'success' | 'error' | 'result' | 'dim';

export interface LogEntry {
  message: string;
  type: LogType;
  args?: any[];
}

export function useLogs() {
  const [logMessages, setLogMessages] = useState<LogEntry[]>([]);

  const newLogMessage = (message: string, type: LogType = 'info', args?: any[]) => {
    setLogMessages((prev) => {
      const next = [...prev, { message, type, args }];
      // Keep the live monitor bounded during long TFT sessions.
      return next.length > 2000 ? next.slice(-2000) : next;
    });
  };

  useEffect(() => {
    const appApi = (window as any).app;
    if (typeof appApi?.onMessage !== 'function') return;

    appApi.onMessage((message: string, type: LogType, args?: any[]) => {
      newLogMessage(message, type ?? 'info', args);
    });
  }, []);

  const clearMessages = () => setLogMessages([]);

  return {
    logMessages,
    newLogMessage,
    clearMessages,
  };
}
