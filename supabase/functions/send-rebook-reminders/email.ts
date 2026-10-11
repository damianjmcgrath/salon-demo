const escape = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function elapsedLabel(attendedAt: string, now = new Date()) {
 const previous = new Date(attendedAt);
 const days = Math.max(0, Math.floor((now.getTime()-previous.getTime())/86400000));
 if(days<7) return `${days} ${days===1?'day':'days'}`;
 // Calendar month count, adjusted when the anniversary has not yet arrived.
 const parts=(d:Date)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Dublin',year:'numeric',month:'numeric',day:'numeric'}).formatToParts(d);
 const val=(d:Date,k:string)=>Number(parts(d).find(p=>p.type===k)?.value);
 let months=(val(now,'year')-val(previous,'year'))*12+val(now,'month')-val(previous,'month');
 if(val(now,'day')<val(previous,'day'))months--;
 if(months>=1)return `${months} ${months===1?'month':'months'}`;
 const weeks=Math.floor(days/7);return `${weeks} ${weeks===1?'week':'weeks'}`;
}
export function rebookPayload(snapshot: Record<string, any>, from: string) {
 const elapsed=elapsedLabel(snapshot.attended_at);
 const link=`https://damianjmcgrath.github.io/salon-demo/?rebook=${encodeURIComponent(snapshot.treatment_id)}`;
 const message=`It has been ${elapsed} since your last ${snapshot.treatment_name}. We'd love to welcome you back.`;
 return {from,to:['damianjmcgrath@gmail.com'],subject:`Time for your next ${snapshot.treatment_name}?`,
 text:`Hello ${snapshot.client_name},\n\n${message}\n\nClick here to rebook: ${link}\n\nSculpted by Aoife Clare\nWilliams St., Mulladrillen, Ardee, Co. Louth A92 HW30\n087 1815137`,
 html:`<!doctype html><html><body style="margin:0;background:#f5f4ef;font-family:Arial,sans-serif;color:#282922"><table role="presentation" width="100%"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" style="max-width:600px;background:#fff;border:1px solid #deded5;border-radius:12px"><tr><td style="padding:36px;text-align:center"><img src="https://damianjmcgrath.github.io/salon-demo/images/salon-logo.png" alt="Sculpted by Aoife Clare" width="220" style="max-width:100%;height:auto"><h1 style="font-family:Georgia,serif;font-size:30px">Ready for your next visit?</h1><p>Hello ${escape(snapshot.client_name)},</p><p style="line-height:1.7">${escape(message)}</p><p style="padding:20px 0"><a href="${escape(link)}" style="background:#282922;color:#fff;padding:16px 26px;text-decoration:none;border-radius:6px;display:inline-block">Rebook ${escape(snapshot.treatment_name)}</a></p><p style="color:#777;line-height:1.7;font-size:13px">Williams St., Mulladrillen, Ardee, Co. Louth A92 HW30<br>087 1815137</p></td></tr></table></td></tr></table></body></html>`};
}
