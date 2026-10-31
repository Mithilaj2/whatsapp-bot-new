/**
 * Things that happened, for notifications (and anything else that wants to know). Emitted after
 * the change is saved.
 */
export const AppEvents = {
  /** { campaignId } */
  CAMPAIGN_FINISHED: 'campaign.finished',
  /** { campaignId, reason } */
  CAMPAIGN_REJECTED: 'campaign.rejected',
  /** { groupId } one credit transaction (give / take back / create / remove) */
  CREDITS_MOVED: 'credits.moved',
  /** { accountId, service } credits went down (campaign or taken back): check for low balance */
  CREDITS_SPENT: 'credits.spent',
  /** { brandId } */
  BRAND_SUBMITTED: 'brand.submitted',
  /** { brandId } approved or sent back */
  BRAND_REVIEWED: 'brand.reviewed',
  /** { botId, contactPhone, contactName, senderNumberId } */
  BOT_HANDOFF: 'bot.handoff',
  /** { senderNumberId, qualityRating?, previousQuality?, error? } */
  NUMBER_ALERT: 'number.alert',
} as const;
