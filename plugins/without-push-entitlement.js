// VidStash only shows local notifications (new episodes of followed shows). expo-notifications
// still adds the push-notification entitlement, which a free Apple account (SideStore) can't
// sign, so it is removed here. No push service is ever used.
const { withEntitlementsPlist } = require('expo/config-plugins');

module.exports = function withoutPushEntitlement(config) {
  return withEntitlementsPlist(config, (c) => {
    delete c.modResults['aps-environment'];
    return c;
  });
};
