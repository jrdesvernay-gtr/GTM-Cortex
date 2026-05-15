import { query } from './db';

export interface Playbook {
  id: string;
  name: string;
  segment: string;
  channel: string;
  template_content: string;
  success_rate: number;
  avg_open_rate: number;
  avg_reply_rate: number;
  sample_count: number;
  created_at: Date;
  updated_at: Date;
}

export async function createPlaybook(data: Partial<Playbook>): Promise<Playbook> {
  const {
    name,
    segment,
    channel,
    template_content,
    success_rate = 0.0,
    avg_open_rate = 0.0,
    avg_reply_rate = 0.0,
    sample_count = 0,
  } = data;

  const result = await query<Playbook>(
    `INSERT INTO playbooks (name, segment, channel, template_content, success_rate, avg_open_rate, avg_reply_rate, sample_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [name, segment, channel, template_content, success_rate, avg_open_rate, avg_reply_rate, sample_count]
  );

  return result.rows[0];
}

export async function getPlaybookBySegment(segment: string, channel: string): Promise<Playbook | null> {
  const result = await query<Playbook>(
    `SELECT * FROM playbooks
     WHERE segment = $1 AND channel = $2
     ORDER BY avg_reply_rate DESC
     LIMIT 1`,
    [segment, channel]
  );
  return result.rows[0] || null;
}

export async function updatePlaybookMetrics(
  id: string,
  openRate: number,
  replyRate: number
): Promise<void> {
  await query(
    `UPDATE playbooks
     SET avg_open_rate = ((avg_open_rate * sample_count) + $1) / (sample_count + 1),
         avg_reply_rate = ((avg_reply_rate * sample_count) + $2) / (sample_count + 1),
         sample_count = sample_count + 1,
         updated_at = NOW()
     WHERE id = $3`,
    [openRate, replyRate, id]
  );
}

export async function getAllPlaybooks(): Promise<Playbook[]> {
  const result = await query<Playbook>(
    'SELECT * FROM playbooks ORDER BY avg_reply_rate DESC'
  );
  return result.rows;
}
