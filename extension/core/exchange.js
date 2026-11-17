import { SHOP_ITEMS, itemLevel, equipmentBasis, purchaseUpgrade } from './shop.js';
import { ESTATE_PRICE, ESTATE_LEVELS, purchaseEstate } from './estate.js';
import { COMPANY_FACILITIES, manageCompany } from './company.js';
const round = n => Math.round(n * 100) / 100;
export const RESALE_RATE = 0.7;
export function exchangeAssets(state) {
  const basis = equipmentBasis(state);
  const rows = SHOP_ITEMS.filter(item => itemLevel(state, item)).map(item => ({ id: item.id, kind: 'equipment', name: item.name,
    detail: `Lv.${itemLevel(state, item)} · 整件出售后等级与加成清零`, cost: basis[item.id] || 0 }));
  for (const estate of state.estates || []) rows.push({ id: estate.host, kind: 'estate', name: estate.host,
    detail: `${ESTATE_LEVELS[estate.level - 1].name} · 出售后释放地产位，总部地址改为线上办公室`,
    cost: Math.min(Math.max(0, (state.estateSpent || 0) - (state.estateDisposedCost || 0)), ESTATE_PRICE + ESTATE_LEVELS.slice(1, estate.level).reduce((sum, level) => sum + level.price, 0)) });
  for (const company of state.companies || []) for (const id of company.facilities || []) {
    const spec = COMPANY_FACILITIES[id];
    if (spec) rows.push({ id: `${company.id}:${id}`, kind: 'facility', companyId: company.id, facilityId: id, name: `${company.name} · ${spec.name}`,
      detail: '拆除后下一单停止生效，当前订单约定保留', cost: Math.min(spec.price, Math.max(0, (state.companyBuildSpent || 0) - (state.companyBuildDisposedCost || 0))) });
  }
  return rows.map(row => ({ ...row, price: round(row.cost * RESALE_RATE) }));
}
export function sellAsset(state, kind, id, expectedPrice) {
  const asset = exchangeAssets(state).find(row => row.kind === kind && row.id === id);
  if (!asset) throw new Error('资产不存在或已经出售');
  if (expectedPrice != null && expectedPrice !== asset.price) throw new Error('回收报价已变化，请刷新后重试');
  let next = state;
  if (kind === 'equipment') next = { ...state, equipmentBasis: { ...equipmentBasis(state), [id]: 0 },
    shopLevels: { ...state.shopLevels, [id]: 0 }, shopDisposedCost: round((state.shopDisposedCost || 0) + asset.cost) };
  if (kind === 'estate') next = { ...state, estates: state.estates.filter(row => row.host !== id),
    companies: (state.companies || []).map(c => c.headquarters === id ? { ...c, headquarters: '' } : c),
    estateDisposedCost: round((state.estateDisposedCost || 0) + asset.cost),
    estateSaleQuotas: { ...(state.estateSaleQuotas || {}), [id]: { lastDay: state.estates.find(e => e.host === id).lastDay, dailyVisits: state.estates.find(e => e.host === id).dailyVisits } } };
  if (kind === 'facility') next = { ...state, companies: state.companies.map(c => c.id === asset.companyId ? { ...c, facilities: c.facilities.filter(f => f !== asset.facilityId) } : c),
    companyBuildDisposedCost: round((state.companyBuildDisposedCost || 0) + asset.cost) };
  return { ...next, assetSales: round((state.assetSales || 0) + asset.price),
    recentEntries: [{ id: crypto.randomUUID(), kind: 'asset_sale', ts: Date.now(), host: asset.name, amount: asset.price,
      reason: `资产回收 · ${asset.name} · 70% 折价，非新增收益` }, ...(state.recentEntries || [])].slice(0, 50) };
}
export function tradeAsset(state, kind, id, target, expectedPrice) {
  const asset = exchangeAssets(state).find(row => row.kind === kind && row.id === id);
  if (!asset || !target || target === (kind === 'facility' ? asset.facilityId : id)) throw new Error('请选择另一项置换目标');
  const sold = sellAsset(state, kind, id, expectedPrice);
  if (kind === 'equipment') return purchaseUpgrade(sold, target);
  if (kind === 'estate') return purchaseEstate(sold, target);
  if (kind === 'facility') return manageCompany(sold, asset.companyId, 'facility', target);
  throw new Error('不支持此类置换');
}
