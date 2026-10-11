export function salonDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-IE', { timeZone: 'Europe/Dublin', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = type => parts.find(p => p.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// Completed treatments use their actual attendance date, including early test checkouts.
function historyDate(appointment) {
  if (appointment.status === 'completed' && appointment.completed_at) {
    const completed = new Date(appointment.completed_at);
    if (!Number.isNaN(completed.getTime())) return salonDate(completed);
  }
  return /^\d{4}-\d{2}-\d{2}$/.test(appointment.appointment_date || '') ? appointment.appointment_date : null;
}

export function lastBookedLabel(bookings, treatmentId, today) {
  const dates = bookings.filter(a => a.status === 'completed' && a.booked_for_self !== false && a.treatment_id === treatmentId).map(historyDate).filter(Boolean).sort();
  return dateLabel(dates.at(-1), today);
}

export function appointmentBookedLabel(appointment, today) {
  return dateLabel(historyDate(appointment), today);
}

function dateLabel(date, today) {
  if (!date) return null;
  // Legacy/demo records without a completion timestamp retain their real scheduled date.
  if (date > today) return `Last Booked: ${date.slice(8,10)}/${date.slice(5,7)}/${date.slice(0,4)}`;
  const days = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(date + 'T00:00:00Z')) / 86400000);
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
