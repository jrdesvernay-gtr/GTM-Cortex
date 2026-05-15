# GTM Cortex

An AI-powered Go-To-Market / RevOps orchestrator that automates lead sourcing, enrichment, and outreach using Claude as the reasoning engine.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         GTM Cortex                              │
│                                                                  │
│  ┌─────────────┐    ┌──────────────────────────────────────┐   │
│  │  REST API   │───▶│       Claude Orchestrator             │   │
│  │  (Express)  │    │  (Anthropic SDK + Tool Use + Cache)   │   │
│  └─────────────┘    └──────────────┬───────────────────────┘   │
│         │                          │                            │
│         │           ┌──────────────▼───────────────────────┐   │
│         │           │            MCP Servers                │   │
│         │           │  ┌────────┐ ┌────────┐ ┌──────────┐  │   │
│         │           │  │ Apify  │ │  Clay  │ │Instantly │  │   │
│         │           │  │(Scrape)│ │(Enrich)│ │(Outreach)│  │   │
│         │           │  └────────┘ └────────┘ └──────────┘  │   │
│         │           └──────────────────────────────────────┘   │
│         │                                                        │
│  ┌──────▼──────────────────────────────────────────────────┐   │
│  │                    PostgreSQL Database                    │   │
│  │  campaigns │ playbooks │ leads │ campaign_feedback        │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Data Flow:**
1. User sends natural language request (e.g., "Find dentists in Seattle and email them")
2. Claude parses intent and decides which tools to invoke
3. Apify scrapes leads from Google Maps or LinkedIn
4. Clay enriches leads with emails, phones, and company info
5. Leads are scored with an ICP algorithm (0-100)
6. Qualified leads (score >= 60) are sent to Instantly for outreach
7. Webhooks capture engagement metrics (opens, clicks, replies, bounces)
8. Claude analyzes performance and stores insights in the feedback loop

## Prerequisites

- Node.js 18+
- PostgreSQL 14+
- API Keys: Anthropic, Apify, Clay, Instantly

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/jrdesvernay-gtr/GTM-Cortex.git
cd GTM-Cortex

# 2. Install dependencies
npm install

# 3. Configure environment variables
cp src/config/env.example .env
# Edit .env with your API keys

# 4. Set up the database
psql $DATABASE_URL -f src/database/schema.sql

# 5. Start the development server
npm run dev
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key (Claude access) |
| `APIFY_API_TOKEN` | Yes | Apify token for Google Maps + LinkedIn scraping |
| `CLAY_API_KEY` | Yes | Clay API key for lead enrichment |
| `INSTANTLY_API_KEY` | Yes | Instantly API key for email outreach |
| `INSTANTLY_API_URL` | No | Instantly API base URL (default: https://api.instantly.ai/api/v1) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `PORT` | No | Server port (default: 3000) |
| `NODE_ENV` | No | Environment: development/production |
| `INSTANTLY_WEBHOOK_SECRET` | No | HMAC secret for webhook signature verification |
| `INSTANTLY_FROM_EMAIL` | No | Sender email for outreach campaigns |
| `INSTANTLY_FROM_NAME` | No | Sender name for outreach campaigns |

## API Usage

### Start a Campaign

```bash
curl -X POST http://localhost:3000/api/campaigns/start \
  -H "Content-Type: application/json" \
  -d '{
    "segment": "dentists in Seattle",
    "source": "email",
    "limit": 50
  }'
```

Response (202 Accepted):
```json
{
  "campaignId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "processing",
  "leadsSourced": 47,
  "leadsEnriched": 45,
  "message": "Campaign created with 32 qualified leads (ICP score >= 60)"
}
```

### Get Campaign Details

```bash
curl http://localhost:3000/api/campaigns/550e8400-e29b-41d4-a716-446655440000
```

Response:
```json
{
  "campaign": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "dentists_seattle_20240115",
    "status": "sending",
    "total_leads_sourced": 47,
    "total_leads_enriched": 45,
    "total_leads_sent": 32,
    "opens": 8,
    "clicks": 2,
    "replies": 1
  },
  "feedback": [
    {
      "insight": "17% open rate is above industry average, suggesting strong subject lines",
      "recommendation": "A/B test call-to-action variants to improve click-through rate"
    }
  ]
}
```

### Get Analytics

```bash
curl http://localhost:3000/api/analytics/recent
```

Response:
```json
{
  "campaigns": [],
  "aggregates": {
    "total_sent": 450,
    "avg_open_rate": 0.187,
    "avg_reply_rate": 0.031,
    "campaign_count": 12
  }
}
```

### Instantly Webhook

Configure this URL in your Instantly dashboard:

```
POST https://your-domain.com/api/webhooks/instantly
```

Expected payload:
```json
{
  "event_type": "email_opened",
  "campaign_id": "instantly_campaign_id",
  "email": "contact@example.com"
}
```

## Supported Webhook Event Types

| Event | Metric Updated |
|---|---|
| `email_opened` | opens |
| `email_clicked` | clicks |
| `email_replied` | replies |
| `email_bounced` | bounces |

## ICP Scoring

Leads are scored 0-100 based on data availability:

| Signal | Points |
|---|---|
| Has valid email | 30 |
| Has phone number | 10 |
| Has LinkedIn URL | 15 |
| Has company size info | 10 |
| Has decision-maker contact | 25 |
| High-value industry match | 10 |

Leads with a score >= 60 are included in outreach campaigns.

## Extending GTM Cortex

### Adding Twilio (SMS Outreach)

1. Install: `npm install twilio`
2. Create `src/mcp-servers/twilio-mcp.ts` following the Instantly MCP pattern
3. Add `create_sms_campaign` tool to `TOOLS` in `claude-orchestrator.ts`
4. Add the `sms` channel case in `campaign-coordinator.ts`

### Adding HubSpot CRM Sync

1. Install: `npm install @hubspot/api-client`
2. Create `src/mcp-servers/hubspot-mcp.ts`
3. Call `syncLeadsToHubSpot(campaignId)` after campaign creation
4. Add a `hubspot_contact_id` column to the `leads` table

### Adding Custom Playbooks

```bash
# Insert a playbook via SQL
INSERT INTO playbooks (name, segment, channel, template_content)
VALUES (
  'Healthcare Email v1',
  'dentists',
  'email',
  'Hi {{firstName}}, I noticed your practice at {{company}}...'
);
```

## Building for Production

```bash
npm run build
npm start
```

## License

MIT
