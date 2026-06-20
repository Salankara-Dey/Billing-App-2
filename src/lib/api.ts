// Client-side DB caller that routes calls dynamically

export async function dbQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  // Check if we are running in Electron and IPC is available
  if (typeof window !== 'undefined' && (window as any).electron?.dbQuery) {
    return (window as any).electron.dbQuery(sql, params);
  }

  // Fallback to Next.js API route (cloud web app mode)
  try {
    const res = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'query', sql, params }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to execute query');
    }
    return data.result;
  } catch (error) {
    console.error('dbQuery fetch error:', error);
    throw error;
  }
}

export async function dbRun(sql: string, params: any[] = []): Promise<{ lastID?: number; changes?: number }> {
  if (typeof window !== 'undefined' && (window as any).electron?.dbRun) {
    return (window as any).electron.dbRun(sql, params);
  }

  try {
    const res = await fetch('/api/db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'run', sql, params }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Failed to execute run');
    }
    return data.result;
  } catch (error) {
    console.error('dbRun fetch error:', error);
    throw error;
  }
}
