// Place overlapping appointments and manual entries in equal-width lanes.
export function diaryEntryLayout(items) {
 const sorted=[...items].sort((a,b)=>a.start_minute-b.start_minute||a.id.localeCompare(b.id)),result={};
 let group=[],end=-1;
 function finish(){const ends=[];for(const item of group){let lane=ends.findIndex(e=>e<=item.start_minute);if(lane<0)lane=ends.length;ends[lane]=item.start_minute+item.duration;result[item.id]={lane};}for(const item of group)result[item.id].width=100/ends.length;group=[];}
 for(const item of sorted){if(item.start_minute>=end){finish();end=-1;}group.push(item);end=Math.max(end,item.start_minute+item.duration);}finish();return result;
}
