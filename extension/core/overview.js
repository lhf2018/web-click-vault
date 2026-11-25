import { investmentValue } from './investments.js';
import { collectibleValue } from './collectibles.js';
import { walletBalance } from './shop.js';
import { companyValuations } from './company.js';
import { estateCost } from './estate.js';
export { achievementOverview } from './achievements.js';
const round = n => Math.round(n * 100) / 100;

export function assetOverview(state) {
  const companyValue = round(companyValuations(state).reduce((sum, row) => sum + row.value, 0));
  const estateValue = round((state.estates || []).reduce((sum, estate) => sum + estateCost(estate), 0));
  const cash = walletBalance(state), equipment = Math.max(0, (state.shopSpent || 0) - (state.shopDisposedCost || 0));
  const collectibles = collectibleValue(state), investments = investmentValue(state);
  return { cash, collectibles, investments, companies: companyValue, estates: estateValue, equipment,
    total: round(cash + companyValue + estateValue + equipment + collectibles + investments) };
}
