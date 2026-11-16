import { walletBalance } from './shop.js';
import { companyLevel } from './company.js';
import { ESTATE_PRICE, ESTATE_LEVELS } from './estate.js';
import { ACHIEVEMENTS } from './constants.js';
const round = n => Math.round(n * 100) / 100;

export function assetOverview(state) {
  const companies = state.companies || [];
  // Allocate historical founding investment by the original escalating cost schedule.
  const weights = companies.length * (companies.length + 1) / 2;
  const companyValue = round(companies.reduce((sum, company, index) => {
    const cost = weights ? (state.companySpent || 0) * (index + 1) / weights : 0;
    return sum + cost * (1 + 0.25 * (companyLevel(company) - 1));
  }, 0));
  const estateValue = round((state.estates || []).reduce((sum, estate) => sum + ESTATE_PRICE +
    ESTATE_LEVELS.slice(1, estate.level).reduce((cost, level) => cost + level.price, 0), 0));
  const cash = walletBalance(state), equipment = state.shopSpent || 0;
  return { cash, companies: companyValue, estates: estateValue, equipment,
    total: round(cash + companyValue + estateValue + equipment) };
}

export function achievementOverview(state) {
  const unlocked = state.unlockedAchievements || [];
  return ACHIEVEMENTS.map(item => ({ ...item, unlocked: unlocked.includes(item.id) || (state.totalAsset || 0) >= item.threshold,
    progress: Math.min(1, Math.max(0, (state.totalAsset || 0) / item.threshold)) }));
}
