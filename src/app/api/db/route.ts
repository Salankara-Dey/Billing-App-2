import { NextResponse } from 'next/server';
import { executeQuery, executeRun } from '@/lib/db';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { action, sql, params = [] } = body;

    if (!sql) {
      return NextResponse.json({ error: 'SQL query is required' }, { status: 400 });
    }

    if (action === 'run') {
      const result = await executeRun(sql, params);
      return NextResponse.json({ success: true, result });
    } else {
      const result = await executeQuery(sql, params);
      return NextResponse.json({ success: true, result });
    }
  } catch (error: any) {
    console.error('Database API Error:', error);
    return NextResponse.json({ error: error.message || 'Database error occurred' }, { status: 500 });
  }
}
