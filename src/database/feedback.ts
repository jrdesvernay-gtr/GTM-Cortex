import { query } from './db';

export interface Feedback {
  id: string;
  campaign_id: string;
  metric_name: string;
  metric_value: number;
  insight: string;
  recommendation: string;
  created_at: Date;
}

export async function createFeedback(data: Partial<Feedback>): Promise<Feedback> {
  const { campaign_id, metric_name, metric_value, insight, recommendation } = data;

  const result = await query<Feedback>(
    `INSERT INTO campaign_feedback (campaign_id, metric_name, metric_value, insight, recommendation)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [campaign_id, metric_name, metric_value, insight, recommendation]
  );

  return result.rows[0];
}

export async function getFeedbackByCampaign(campaignId: string): Promise<Feedback[]> {
  const result = await query<Feedback>(
    'SELECT * FROM campaign_feedback WHERE campaign_id = $1 ORDER BY created_at DESC',
    [campaignId]
  );
  return result.rows;
}

export async function getRecentInsights(days: number): Promise<Feedback[]> {
  const result = await query<Feedback>(
    `SELECT * FROM campaign_feedback
     WHERE created_at >= NOW() - INTERVAL '${days} days'
     ORDER BY created_at DESC`,
    []
  );
  return result.rows;
}
