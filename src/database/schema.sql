-- GTM Cortex Database Schema

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Campaigns table
CREATE TABLE IF NOT EXISTS campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  source_type VARCHAR(50),
  segment VARCHAR(255),
  playbook_id UUID,
  total_leads_sourced INT DEFAULT 0,
  total_leads_enriched INT DEFAULT 0,
  total_leads_sent INT DEFAULT 0,
  opens INT DEFAULT 0,
  clicks INT DEFAULT 0,
  replies INT DEFAULT 0,
  bounces INT DEFAULT 0,
  channel VARCHAR(50),
  instantly_campaign_id VARCHAR(255),
  status VARCHAR(50) DEFAULT 'draft',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
);

-- Playbooks table
CREATE TABLE IF NOT EXISTS playbooks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  segment VARCHAR(255),
  channel VARCHAR(50),
  template_content TEXT,
  success_rate FLOAT DEFAULT 0.0,
  avg_open_rate FLOAT DEFAULT 0.0,
  avg_reply_rate FLOAT DEFAULT 0.0,
  sample_count INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Campaign feedback table
CREATE TABLE IF NOT EXISTS campaign_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  metric_name VARCHAR(100),
  metric_value FLOAT,
  insight TEXT,
  recommendation TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Leads table
CREATE TABLE IF NOT EXISTS leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(100),
  company VARCHAR(255),
  title VARCHAR(255),
  location VARCHAR(255),
  linkedin_url VARCHAR(500),
  source_data JSONB,
  enriched_data JSONB,
  icp_score INT DEFAULT 0,
  status VARCHAR(50) DEFAULT 'raw',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_campaigns_status ON campaigns(status);
CREATE INDEX IF NOT EXISTS idx_campaigns_segment ON campaigns(segment);
CREATE INDEX IF NOT EXISTS idx_leads_campaign_id ON leads(campaign_id);
CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email);
CREATE INDEX IF NOT EXISTS idx_campaign_feedback_campaign_id ON campaign_feedback(campaign_id);
