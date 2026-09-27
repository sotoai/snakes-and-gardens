export const MINT='GTBxUiw6wJdmmkCGZgRHLyYxqu1vG4KtRpeox6yDpump';
export const POOL='4R8CiMnJWDNoes3fQi1ccPFJygPXazaHaWpHrN3rZeNj';
export const QUOTE_URL=`https://api.dexscreener.com/token-pairs/v1/solana/${MINT}`;
export const HISTORY_URL=`https://api.geckoterminal.com/api/v2/networks/solana/pools/${POOL}/ohlcv/hour?aggregate=1&limit=168&currency=usd`;
const number=value=>(typeof value==='number'||(typeof value==='string'&&value.trim()!==''))&&Number.isFinite(Number(value))?Number(value):null;
const nonnegative=value=>{const n=number(value);return n!==null&&n>=0?n:null;};
export function parseQuote(payload){
  const pair=Array.isArray(payload)&&payload.find(p=>p.chainId==='solana'&&p.pairAddress===POOL&&p.baseToken?.address===MINT&&p.quoteToken?.address==='So11111111111111111111111111111111111111112');
  const price=pair&&nonnegative(pair.priceUsd);
  if(!pair||price===null||price<=0)throw new Error('The expected JEANPHIL pool is unavailable.');
  return {price,change:number(pair.priceChange?.h24),volume:nonnegative(pair.volume?.h24),liquidity:nonnegative(pair.liquidity?.usd)};
}
export function parseHistory(payload,now=Date.now()){
  if(payload?.meta?.base?.address!==MINT||!Array.isArray(payload?.data?.attributes?.ohlcv_list))throw new Error('Unexpected chart asset.');
  const points=new Map();
  for(const row of payload.data.attributes.ohlcv_list){
    if(!Array.isArray(row)||row.length<5)continue;
    const time=number(row[0]),price=nonnegative(row[4]);
    // Show completed hourly candles only; never label the current partial hour a close.
    if(time!==null&&Number.isInteger(time)&&time>0&&time*1000+3600000<=now&&price!==null&&price>0)points.set(time,{time:time+3600,price});
  }
  const result=[...points.values()].sort((a,b)=>a.time-b.time).slice(-168);
  if(result.length<2)throw new Error('Not enough completed hourly candles.');
  return result;
}
export function selectPeriod(points,hours){
  const cutoff=points.at(-1).time-hours*3600;
  return points.filter(point=>point.time>cutoff);
}
export function chartGeometry(points,width=900){
  let low=Math.min(...points.map(p=>p.price)),high=Math.max(...points.map(p=>p.price));
  const pad=Math.max((high-low)*.12,high*.015,1e-9);low=Math.max(0,low-pad);high+=pad;
  const start=points[0].time,span=Math.max(1,points.at(-1).time-start);
  const xy=points.map(p=>({x:82+(p.time-start)/span*(width-110),y:22+(1-(p.price-low)/(high-low))*240}));
  // Break the line over missing hours instead of implying continuous observations.
  const path=xy.map((p,i)=>`${i===0||points[i].time-points[i-1].time>3600?'M':'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
  return {low,high,xy,path};
}
