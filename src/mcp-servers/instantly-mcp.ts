import axios, { AxiosError } from 'axios';
import { INSTANTLY_BASE_URL } from '../config/constants';

const logger = {
  info: (...a: unknown[]) => console.log('[INFO]', ...a),
  error: (...a: unknown[]) => console.error('[ERROR]', ...a),
  warn: (...a: unknown[]) => console.warn('[WARN]', ...a),
};

export interface Recipient {
  email: string;
  firstName: string;
  lastName: string;
  company: string;
}

export interface LinkedInRecipient {
  linkedin_url: string;
  name: string;
}

export interface CampaignStats {
  opens: number;
  clicks: number;
  replies: number;
  bounces: number;
}

interface InstantlyCreateCampaignResponse {
  id: string;
  status: string;
}

interface InstantlyAnalyticsResponse {
  data?: {
    opens?: number;
    clicks?: number;
    replies?: number;
    bounces?: number;
  };
  opens?: number;
  clicks?: number;
  replies?: number;
  bounces?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function instantlyRequest<T>(
  method: 'get' | 'post',
  path: string,
  data?: unknown,
  retries = 3
): Promise<T> {
  const apiKey = process.env.INSTANTLY_API_KEY;
  const url = `${INSTANTLY_BASE_URL}${path}`;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await axios.request<T>({
        method,
        url,
        data,
        params: method === 'get' ? data : undefined,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      });
      return response.data;
    } catch (err) {
      if (err instanceof AxiosError) {
        if (err.response?.status === 429) {
          const retryAfter = parseInt(err.response.headers['retry-after'] || '5', 10);
          logger.warn(`Instantly rate limited, waiting ${retryAfter}s (attempt ${attempt}/${retries})`);
          await sleep(retryAfter * 1000);
          continue;
        }
        if (attempt === retries) {
          logger.error('Instantly API error after retries', err.response?.data);
          throw err;
        }
        await sleep(1000 * attempt);
      } else {
        throw err;
      }
    }
  }
  throw new Error('Max retries exceeded for Instantly API');
}

export async function createEmailCampaign(
  name: string,
  templateSubject: string,
  templateBody: string,
  recipients: Recipient[]
): Promise<{ campaignId: string }> {
  logger.info(`Creating email campaign: ${name} with ${recipients.length} recipients`);

  const fromEmail = process.env.INSTANTLY_FROM_EMAIL || 'outreach@company.com';
  const fromName = process.env.INSTANTLY_FROM_NAME || 'GTM Team';

  try {
    // Create the campaign
    const campaignResponse = await instantlyRequest<InstantlyCreateCampaignResponse>(
      'post',
      '/campaign/create',
      {
        name,
        from_name: fromName,
        from_email: fromEmail,
        subject: templateSubject,
        body: templateBody,
      }
    );

    const campaignId = campaignResponse.id;
    logger.info(`Campaign created: ${campaignId}`);

    // Add leads in batches of 100
    const batchSize = 100;
    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);
      await instantlyRequest('post', '/lead/add', {
        campaign_id: campaignId,
        leads: batch.map((r) => ({
          email: r.email,
          first_name: r.firstName,
          last_name: r.lastName,
          company_name: r.company,
        })),
      });
    }

    logger.info(`Added ${recipients.length} leads to campaign ${campaignId}`);
    return { campaignId };
  } catch (err) {
    logger.error('Failed to create email campaign', err);
    throw err;
  }
}

export async function createLinkedInCampaign(
  name: string,
  message: string,
  recipients: LinkedInRecipient[]
): Promise<{ campaignId: string }> {
  // LinkedIn outreach via Instantly is currently a simulation
  // In production, integrate with a LinkedIn automation tool
  logger.info(`[LinkedIn] Campaign "${name}" queued for ${recipients.length} recipients`);
  logger.info(`[LinkedIn] Message template: ${message.substring(0, 100)}...`);
  logger.warn('[LinkedIn] LinkedIn API integration requires a dedicated LinkedIn automation service. Using mock campaign ID.');

  const mockCampaignId = `li_mock_${Date.now()}`;
  logger.info(`[LinkedIn] Mock campaign ID: ${mockCampaignId}`);
  return { campaignId: mockCampaignId };
}

export async function scheduleSend(
  campaignId: string,
  scheduledAt?: Date
): Promise<void> {
  logger.info(`Launching campaign: ${campaignId}${scheduledAt ? ` at ${scheduledAt.toISOString()}` : ' immediately'}`);

  try {
    await instantlyRequest('post', '/campaign/launch', {
      campaign_id: campaignId,
      ...(scheduledAt ? { scheduled_at: scheduledAt.toISOString() } : {}),
    });
    logger.info(`Campaign ${campaignId} launched successfully`);
  } catch (err) {
    logger.error(`Failed to launch campaign ${campaignId}`, err);
    throw err;
  }
}

export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  logger.info(`Fetching stats for campaign: ${campaignId}`);

  try {
    const response = await instantlyRequest<InstantlyAnalyticsResponse>(
      'get',
      '/analytics/campaign/summary',
      { campaign_id: campaignId }
    );

    const data = response.data || response;
    return {
      opens: data.opens || 0,
      clicks: data.clicks || 0,
      replies: data.replies || 0,
      bounces: data.bounces || 0,
    };
  } catch (err) {
    logger.error(`Failed to get stats for campaign ${campaignId}`, err);
    // Return zeros on error so feedback loop doesn't crash
    return { opens: 0, clicks: 0, replies: 0, bounces: 0 };
  }
}
