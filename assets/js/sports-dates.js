// Melbourne-local sports schedule date helpers.
function nbaLocalDay(date){const parts=new Intl.DateTimeFormat("en-AU",{timeZone:"Australia/Melbourne",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);const get=k=>parts.find(p=>p.type===k)?.value||"";return get("year")+"-"+get("month")+"-"+get("day")}
function nbaStartOfDay(offset){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+offset);return nbaLocalDay(d)}
