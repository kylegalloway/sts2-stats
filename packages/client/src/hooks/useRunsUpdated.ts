import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

export function useRunsUpdated() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const es = new EventSource('/api/events');
    es.onmessage = (e) => {
      const event = JSON.parse(e.data) as { type: string };
      if (event.type === 'run_added' || event.type === 'run_updated') {
        queryClient.invalidateQueries();
      }
    };
    es.onerror = () => {
      // EventSource will auto-reconnect; nothing to do here
    };
    return () => es.close();
  }, [queryClient]);
}
