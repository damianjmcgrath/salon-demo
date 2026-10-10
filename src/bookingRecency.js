export function salonDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// Compare salon calendar dates rather than elapsed hours (including DST changes).
export function lastBookedLabel(bookings, treatmentId, today) {
  const dates = bookings.filter(a => a.status === 'completed' && a.booked_for_self !== false && a.treatment_id === treatmentId && /^\d{4}-\d{2}-\d{2}$/.test(a.appointment_date || '') && a.appointment_date <= today).map(a => a.appointment_date).sort();
  if (!dates.length) return null;
  const days = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(dates.at(-1) + 'T00:00:00Z')) / 86400000);
  return appointmentAgeLabel(days);
}

export function appointmentBookedLabel(appointment, today) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(appointment.appointment_date || "") || appointment.appointment_date > today) return null;
  const days = Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(appointment.appointment_date + "T00:00:00Z")) / 86400000);
  return appointmentAgeLabel(days);
}

function appointmentAgeLabel(days) {
  let age;
  if (days === 0) age = 'Today';
  else if (days <= 5) age = `${days} ${days === 1 ? 'day' : 'days'} ago`;
  else if (days <= 8) age = '1 week ago';
  else if (days <= 12) age = `${days} days ago`;
  else if (days <= 15) age = '2 weeks ago';
  else if (days <= 19) age = `${days} days ago`;
  else if (days <= 22) age = '3 weeks ago';
  else if (days <= 26) age = `${days} days ago`;
  else if (days <= 33) age = '1 month ago';
  else if (days <= 39) age = '5 weeks ago';
  else if (days <= 47) age = '6 weeks ago';
  else if (days <= 53) age = '7 weeks ago';
  else if (days <= 75) age = '2 months ago';
  else if (days <= 105) age = '3 months ago';
  else age = 'Longer than 3 months ago';
  return `Last Booked: ${age}`;
}
