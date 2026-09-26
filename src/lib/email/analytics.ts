/** Figures from what Aimelia has actually done, not the made-up numbers the old screen showed. */
import { q } from '../db'

export async function analytics(days = 30) {
  const since = `now() - interval '${Math.min(Math.max(days, 1), 365)} days'`
  const [byCategory, byUrgency, byMethod, perDay, totals, meetings, tasks] = await Promise.all([
    q(`SELECT category, count(*)::int AS n FROM emails WHERE triaged_at > ${since} GROUP BY category ORDER BY n DESC`),
    q(`SELECT urgency, count(*)::int AS n FROM emails WHERE triaged_at > ${since} GROUP BY urgency ORDER BY urgency DESC`),
    q(`SELECT method, count(*)::int AS n FROM emails WHERE triaged_at > ${since} GROUP BY method`),
    q(`SELECT to_char(received_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS day, count(*)::int AS n FROM emails
       WHERE received_at > now() - interval '14 days' GROUP BY day ORDER BY day`),
    q(`SELECT count(*)::int AS emails, count(*) FILTER (WHERE urgency >= 4)::int AS urgent, count(draft_id)::int AS drafts,
       COALESCE(avg(confidence) FILTER (WHERE method = 'ai'), 0)::real AS ai_confidence FROM emails WHERE triaged_at > ${since}`),
    q(`SELECT count(*) FILTER (WHERE brief IS NOT NULL)::int AS briefs FROM meetings WHERE brief_generated_at > ${since}`),
    q(`SELECT count(*) FILTER (WHERE status = 'done')::int AS done, count(*)::int AS created FROM tasks WHERE created_at > ${since}`),
  ])
  return { days, totals: { ...totals[0], briefs: meetings[0].briefs, tasks_created: tasks[0].created, tasks_done: tasks[0].done },
    by_category: byCategory, by_urgency: byUrgency, by_method: byMethod, per_day: perDay }
}
