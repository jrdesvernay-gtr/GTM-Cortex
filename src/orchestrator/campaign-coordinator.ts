import { getCampaignById, updateCampaign } from '../database/campaigns';
import { getPlaybookBySegment } from '../database/playbooks';
import { EnrichedLead } from '../mcp-servers/clay-mcp';
import {
  createEmailCampaign,
  createLinkedInCampaign,
  scheduleSend,
  Recipient,
  LinkedInRecipient,
} from '../mcp-servers/instantly-mcp';
import { ICP_SCORE_THRESHOLD } from '../config/constants';

const logger = {
  info: (...a: unknown[]) => console.log('[INFO]', ...a),
  error: (...a: unknown[]) => console.error('[ERROR]', ...a),
  warn: (...a: unknown[]) => console.warn('[WARN]', ...a),
};

export function getDefaultTemplate(segment: string, channel: string): { subject: string; body: string } {
  const segmentLower = segment.toLowerCase();

  // Healthcare / Medical
  if (segmentLower.includes('dentist') || segmentLower.includes('doctor') || segmentLower.includes('clinic')) {
    return {
      subject: 'Quick question about your practice',
      body: `Hi {{firstName}},

I came across {{company}} and was impressed by your work in the community.

We help healthcare practices like yours streamline patient outreach and grow their patient base.

Would you have 15 minutes this week for a quick call to explore if this could be a fit?

Best,
{{senderName}}`,
    };
  }

  // Restaurant / Food & Beverage
  if (segmentLower.includes('restaurant') || segmentLower.includes('coffee') || segmentLower.includes('cafe')) {
    return {
      subject: 'Helping {{company}} attract more customers',
      body: `Hi {{firstName}},

I noticed {{company}} and wanted to reach out about helping you attract more customers through targeted digital marketing.

Our platform helps local businesses like yours increase foot traffic and online orders by 30% on average.

Can we connect for a quick 15-minute call this week?

Cheers,
{{senderName}}`,
    };
  }

  // SaaS / Tech
  if (segmentLower.includes('saas') || segmentLower.includes('tech') || segmentLower.includes('cto') || segmentLower.includes('vp')) {
    return {
      subject: 'Saw your work at {{company}}',
      body: `Hi {{firstName}},

I came across {{company}} and was curious about how you're currently handling {{painPoint}}.

We've helped similar companies reduce their time-to-value by 40%.

Worth a 20-minute call to see if there's a fit?

Best,
{{senderName}}`,
    };
  }

  // LinkedIn-specific default
  if (channel === 'linkedin') {
    return {
      subject: '',
      body: `Hi {{firstName}},

I noticed your work at {{company}} and wanted to connect. We're helping companies in your space achieve better results with less effort.

Would love to share what we're seeing in the market — open to a quick conversation?

{{senderName}}`,
    };
  }

  // Generic default
  return {
    subject: 'Quick question for {{company}}',
    body: `Hi {{firstName}},

I came across {{company}} and thought there might be an opportunity to work together.

We help businesses like yours achieve better results. Would you be open to a quick 15-minute call this week?

Best,
{{senderName}}`,
  };
}

export async function coordinateCampaign(
  campaignId: string,
  leads: EnrichedLead[],
  channel: string,
  templateOverride?: string
): Promise<void> {
  logger.info(`Coordinating campaign ${campaignId} for ${leads.length} leads via ${channel}`);

  try {
    const campaign = await getCampaignById(campaignId);
    if (!campaign) {
      throw new Error(`Campaign ${campaignId} not found`);
    }

    // Filter leads by ICP score
    const qualifiedLeads = leads.filter((l) => l.icp_score >= ICP_SCORE_THRESHOLD);
    logger.info(`${qualifiedLeads.length}/${leads.length} leads qualify (ICP ≥ ${ICP_SCORE_THRESHOLD})`);

    if (qualifiedLeads.length === 0) {
      await updateCampaign(campaignId, { status: 'no_qualified_leads' });
      logger.warn(`No qualified leads for campaign ${campaignId}`);
      return;
    }

    // Fetch best playbook for this segment+channel
    const playbook = await getPlaybookBySegment(campaign.segment, channel);
    const template = templateOverride
      ? { subject: 'Custom Outreach', body: templateOverride }
      : playbook
      ? { subject: playbook.name, body: playbook.template_content }
      : getDefaultTemplate(campaign.segment, channel);

    logger.info(`Using template: ${playbook ? `playbook "${playbook.name}"` : 'default template'}`);

    let instantlyCampaignId: string;

    if (channel === 'email') {
      const recipients: Recipient[] = qualifiedLeads
        .filter((l) => l.email && l.email.includes('@'))
        .map((l) => {
          const nameParts = l.name.split(' ');
          return {
            email: l.email!,
            firstName: nameParts[0] || l.name,
            lastName: nameParts.slice(1).join(' ') || '',
            company: l.company || l.raw['title'] as string || '',
          };
        });

      if (recipients.length === 0) {
        await updateCampaign(campaignId, { status: 'no_email_leads' });
        logger.warn(`No leads with valid emails for campaign ${campaignId}`);
        return;
      }

      const result = await createEmailCampaign(
        campaign.name,
        template.subject,
        template.body,
        recipients
      );
      instantlyCampaignId = result.campaignId;

    } else {
      // LinkedIn channel
      const recipients: LinkedInRecipient[] = qualifiedLeads
        .filter((l) => l.linkedin_url)
        .map((l) => ({
          linkedin_url: l.linkedin_url!,
          name: l.name,
        }));

      const result = await createLinkedInCampaign(
        campaign.name,
        template.body,
        recipients
      );
      instantlyCampaignId = result.campaignId;
    }

    // Schedule send
    await scheduleSend(instantlyCampaignId);

    // Update campaign record
    await updateCampaign(campaignId, {
      instantly_campaign_id: instantlyCampaignId,
      total_leads_sent: qualifiedLeads.length,
      status: 'sending',
      sent_at: new Date(),
    });

    logger.info(`Campaign ${campaignId} launched. Instantly ID: ${instantlyCampaignId}`);
  } catch (err) {
    logger.error(`Campaign coordination failed for ${campaignId}`, err);
    await updateCampaign(campaignId, { status: 'failed' }).catch(() => {});
    throw err;
  }
}
