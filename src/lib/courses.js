// What the Courses page and a course's own page share: the facts shown next to
// a course, and where its "More information" button leads.
import { localize } from './content.js';
import { strings } from './i18n.js';
import { formatRange } from './format.js';

const languageName = (code, lang) => {
  try {
    const name = new Intl.DisplayNames([lang], { type: 'language' }).of(code);
    return name.charAt(0).toLocaleUpperCase(lang) + name.slice(1);
  } catch { return code; }
};

// The course's texts in this language (or the default one where missing).
export const courseText = (course, lang) => localize(course.entry, lang);

// [label, value] pairs, in this order; empty ones are left out.
export function courseFacts(course, text, lang) {
  const c = strings(lang).courses;
  return [
    [c.dates, course.start || course.end ? formatRange(course.start, course.end, lang) : ''],
    [c.schedule, text.schedule],
    [c.format, c.formats[course.format] ?? course.format],
    [c.languages, course.languages.map((l) => languageName(l, lang)).join(', ')],
    [c.workload, course.ects ? c.ects(course.ects) : course.hours ? c.hours(course.hours) : ''],
    [c.institution, text.institution],
  ].filter(([, value]) => value);
}

// The course's own page on this site (only courses with page text have one).
export const coursePageUrl = (course, lang) => {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  return `${base}${lang}/teaching/courses/${course.id}/`;
};

// Where "More information" leads: the course's own page if it has one, or
// else its external link (or nowhere).
export const courseMoreInfo = (course, lang) => (course.hasPage ? coursePageUrl(course, lang) : course.url || '');
