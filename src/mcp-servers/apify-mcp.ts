import axios, { AxiosError } from 'axios';
import { APIFY_BASE_URL, GOOGLE_MAPS_ACTOR_ID, LINKEDIN_ACTOR_ID } from '../config/constants';

const logger = {
  info: (...a: unknown[]) => console.log('[INFO]', ...a),
  error: (...a: unknown[]) => console.error('[ERROR]', ...a),
  warn: (...a: unknown[]) => console.warn('[WARN]', ...a),
};

export interface Lead {
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  category?: string;
  rating?: number;
  source: string;
  raw: Record<string, unknown>;
}

interface ApifyRunResponse {
  data: {
    id: string;
    defaultDatasetId: string;
    status: string;
  };
}

interface ApifyRunStatus {
  data: {
    status: string;
    defaultDatasetId: string;
  };
}

async function waitForRun(actorId: string, runId: string): Promise<string> {
  const apiToken = process.env.APIFY_API_TOKEN;
  const maxWaitMs = 5 * 60 * 1000;
  const startTime = Date.now();
  let delay = 3000;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await axios.get<ApifyRunStatus>(
        `${APIFY_BASE_URL}/acts/${actorId}/runs/${runId}`,
        { params: { token: apiToken } }
      );

      const { status, defaultDatasetId } = response.data.data;
      logger.info(`Run ${runId} status: ${status}`);

      if (status === 'SUCCEEDED') {
        return defaultDatasetId;
      }
      if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
        throw new Error(`Apify run ${runId} ended with status: ${status}`);
      }

      await sleep(delay);
      delay = Math.min(delay * 1.5, 15000); // exponential backoff, cap at 15s
    } catch (err) {
      if (err instanceof AxiosError && err.response?.status === 429) {
        logger.warn('Rate limited by Apify, waiting 10s...');
        await sleep(10000);
      } else {
        throw err;
      }
    }
  }

  throw new Error(`Apify run ${runId} timed out after 5 minutes`);
}

async function getDataset(datasetId: string): Promise<unknown[]> {
  const apiToken = process.env.APIFY_API_TOKEN;
  try {
    const response = await axios.get<{ items: unknown[] }>(
      `${APIFY_BASE_URL}/datasets/${datasetId}/items`,
      { params: { token: apiToken, clean: true, format: 'json' } }
    );
    return response.data as unknown[];
  } catch (err) {
    logger.error('Failed to fetch dataset', err);
    throw err;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runGoogleMapsScraper(
  searchQuery: string,
  location: string,
  limit: number
): Promise<Lead[]> {
  const apiToken = process.env.APIFY_API_TOKEN;
  logger.info(`Starting Google Maps scraper: "${searchQuery}" in "${location}", limit: ${limit}`);

  try {
    const runResponse = await axios.post<ApifyRunResponse>(
      `${APIFY_BASE_URL}/acts/${GOOGLE_MAPS_ACTOR_ID}/runs`,
      {
        searchStringsArray: [`${searchQuery} ${location}`],
        maxCrawledPlacesPerSearch: limit,
        language: 'en',
      },
      { params: { token: apiToken } }
    );

    const runId = runResponse.data.data.id;
    logger.info(`Google Maps run started: ${runId}`);

    const datasetId = await waitForRun(GOOGLE_MAPS_ACTOR_ID, runId);
    const items = await getDataset(datasetId);

    return items.map((item) => {
      const i = item as Record<string, unknown>;
      return {
        name: (i.title as string) || (i.name as string) || 'Unknown',
        address: (i.address as string) || (i.street as string) || undefined,
        phone: (i.phone as string) || undefined,
        website: (i.website as string) || undefined,
        category: (i.categoryName as string) || undefined,
        rating: (i.totalScore as number) || undefined,
        source: 'google_maps',
        raw: i,
      };
    });
  } catch (err) {
    logger.error('Google Maps scraper failed', err);
    throw err;
  }
}

export async function runLinkedInScraper(
  jobTitle: string,
  company: string,
  location: string,
  limit: number
): Promise<Lead[]> {
  const apiToken = process.env.APIFY_API_TOKEN;
  const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${jobTitle} ${company}`)}&location=${encodeURIComponent(location)}`;

  logger.info(`Starting LinkedIn scraper: "${jobTitle}" at "${company}" in "${location}"`);

  try {
    const runResponse = await axios.post<ApifyRunResponse>(
      `${APIFY_BASE_URL}/acts/${LINKEDIN_ACTOR_ID}/runs`,
      {
        searchUrl,
        count: limit,
      },
      { params: { token: apiToken } }
    );

    const runId = runResponse.data.data.id;
    logger.info(`LinkedIn run started: ${runId}`);

    const datasetId = await waitForRun(LINKEDIN_ACTOR_ID, runId);
    const items = await getDataset(datasetId);

    return items.map((item) => {
      const i = item as Record<string, unknown>;
      return {
        name: (i.fullName as string) || (i.name as string) || 'Unknown',
        phone: (i.phone as string) || undefined,
        website: (i.linkedinUrl as string) || undefined,
        category: jobTitle,
        source: 'linkedin',
        raw: i,
      };
    });
  } catch (err) {
    logger.error('LinkedIn scraper failed', err);
    throw err;
  }
}
