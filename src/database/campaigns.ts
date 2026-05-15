import { query } from './db';

export interface Campaign {
  id: string;
  name: string;
  source_type: string;
  segment: string;
  playbook_id?: string;
  total_leads_sourced: number;
  total_leads_enriched: number;
  total_leads_sent: number;
  opens: number;
  clicks: number;
  replies: number;
  bounces: number;
  channel: string;
  instantly_campaign_id?: string;
  status: string;
  created_at: Date;
  sent_at?: Date;
  completed_at?: Date;
}

export async function createCampaign(data: Partial<Campaign>): Promise<Campaign> {
  const {
    name,
    source_type,
    segment,
    playbook_id,
    channel,
    status = 'draft',
  } = data;

  const result = await query<Campaign>(
    `INSERT INTO campaigns (name, source_type, segment, playbook_id, channel, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [name, source_type, segment, playbook_id || null, channel, status]
  );

  return result.rows[0];
}

export async function getCampaignById(id: string): Promise<Campaign | null> {
  const result = await query<Campaign>(
    'SELECT * FROM campaigns WHERE id = $1',
    [id]
  );
  return result.rows[0] || null;
}

export async function updateCampaign(id: string, data: Partial<Campaign>): Promise<Campaign> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  const allowedFields: (keyof Campaign)[] = [
    'name', 'source_type', 'segment', 'playbook_id',
    'total_leads_sourced', 'total_leads_enriched', 'total_leads_sent',
    'channel', 'instantly_campaign_id', 'status', 'sent_at', 'completed_at',
  ];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      fields.push(`${field} = $${paramIndex}`);
      values.push(data[field]);
      paramIndex++;
    }
  }

  if (fields.length === 0) {
    const existing = await getCampaignById(id);
    if (!existing) throw new Error(`Campaign ${id} not found`);
    return existing;
  }

  values.push(id);
  const result = await query<Campaign>(
    `UPDATE campaigns SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error(`Campaign ${id} not found`);
  }

  return result.rows[0];
}

export async function updateCampaignMetrics(
  id: string,
  metric: 'opens' | 'clicks' | 'replies' | 'bounces'
): Promise<void> {
  await query(
    `UPDATE campaigns SET ${metric} = ${metric} + 1 WHERE id = $1`,
    [id]
  );
}

export async function getRecentCampaigns(limit: number): Promise<Campaign[]> {
  const result = await query<Campaign>(
    'SELECT * FROM campaigns ORDER BY created_at DESC LIMIT $1',
    [limit]
  );
  return result.rows;
}

export async function getCampaignsByStatus(status: string): Promise<Campaign[]> {
  const result = await query<Campaign>(
    'SELECT * FROM campaigns WHERE status = $1 ORDER BY created_at DESC',
    [status]
  );
  return result.rows;
}
