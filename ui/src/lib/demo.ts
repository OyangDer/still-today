// Sample Canvas and calendar feed answers: the design-time mock host's, and the Mac demo mode's
// (STILL_TODAY_DEMO=1), which runs the real widget on them for screenshots.

const day = (offset: number, h = 23, m = 59) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(h, m, 0, 0);
  return d;
};

const courses = [
  { id: 1, course_code: 'PMGT5850 (ALL)', name: 'Project Management Capstone' },
  { id: 2, course_code: 'PMGT5889 (ALL)', name: 'Project Risk' },
  { id: 3, course_code: '48430 Fundamentals of C Programming - Spring 2026', name: 'Fundamentals of C Programming' },
];

const assignments: Record<number, unknown[]> = {
  1: [
    { id: 101, name: 'A3 - Risk Register', due_at: day(1).toISOString(), points_possible: 20, html_url: 'https://canvas.example.edu/courses/1/assignments/101', description: '<p>Build a <strong>risk register</strong> for your capstone project.</p><ul><li>Identify at least 12 risks</li><li>Rate likelihood and impact</li><li>Propose responses and owners</li></ul><p>Submit as a single PDF. See the <a href="https://canvas.example.edu/rubric">rubric</a>.</p>', submission: { workflow_state: 'unsubmitted' } },
    { id: 102, name: 'Team progress presentation', due_at: day(4, 17, 0).toISOString(), points_possible: 15, submission: { workflow_state: 'unsubmitted' } },
    { id: 103, name: 'A2 - Project Charter', due_at: day(-10).toISOString(), points_possible: 20, submission: { workflow_state: 'graded' } },
    { id: 104, name: 'Weekly reflection 8', due_at: day(-2).toISOString(), points_possible: 2, submission: { workflow_state: 'unsubmitted', missing: true } },
  ],
  2: [
    { id: 201, name: 'Stakeholder engagement plan', due_at: day(0, 21, 0).toISOString(), points_possible: 25, submission: { workflow_state: 'unsubmitted' } },
    { id: 202, name: 'Risk analysis & response', due_at: day(9).toISOString(), points_possible: 30, submission: { workflow_state: 'unsubmitted' } },
    { id: 203, name: 'Wk 1 Quiz', due_at: day(-40).toISOString(), is_quiz_assignment: true, points_possible: 5, submission: { workflow_state: 'pending_review' } },
  ],
  3: [
    { id: 301, name: 'Research methods reflection', due_at: day(3).toISOString(), points_possible: 10, submission: { workflow_state: 'unsubmitted' } },
    { id: 302, name: 'Literature map', due_at: null, points_possible: null, submission: { workflow_state: 'unsubmitted' } },
  ],
};

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

function feed(): string {
  const lecture = day(-14, 18, 0);
  const tutorial = day(-13, 10, 0);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'X-WR-CALNAME:Semester 2 timetable',
    'BEGIN:VEVENT',
    'UID:lecture-5850',
    `DTSTART:${stamp(lecture)}`,
    `DTEND:${stamp(new Date(lecture.getTime() + 2 * 3600e3))}`,
    'RRULE:FREQ=WEEKLY;COUNT=12',
    'SUMMARY:PMGT5850 Capstone seminar',
    'LOCATION:Abercrombie Building 2080',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:tut-5889',
    `DTSTART:${stamp(tutorial)}`,
    `DTEND:${stamp(new Date(tutorial.getTime() + 3600e3))}`,
    'RRULE:FREQ=WEEKLY;COUNT=12',
    'SUMMARY:PMGT5889 Tutorial',
    'LOCATION:Fisher Library 213',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:break',
    `DTSTART;VALUE=DATE:${stamp(day(6)).slice(0, 8)}`,
    `DTEND;VALUE=DATE:${stamp(day(11)).slice(0, 8)}`,
    'SUMMARY:Mid-semester break',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.join('\r\n');
}

function canvasEvents() {
  return [0, 7, 14].map((offset, i) => ({
    id: 500 + i,
    title: 'PMGT5850 Capstone seminar',
    start_at: day(offset + 1, 18, 0).toISOString(),
    end_at: day(offset + 1, 21, 0).toISOString(),
    location_name: 'Zoom Online Meeting',
    context_code: 'course_1',
  }));
}

function announcements() {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600e3).toISOString();
  return [
    { id: 71, title: 'Week 8: one-on-one interviews and reflections', posted_at: hoursAgo(2), context_code: 'course_1', user_name: 'Alex Morgan', read_state: 'unread', message: '<p>Book your interview slot <strong>before Friday</strong>.</p><ul><li>15 minutes per team</li><li>Bring your project plan</li></ul>', html_url: 'https://canvas.example.edu/courses/1/discussion_topics/71' },
    { id: 72, title: 'Risk register feedback released', posted_at: hoursAgo(26), context_code: 'course_2', user_name: 'Priya Nair', read_state: 'unread', message: '<p>Feedback is on the rubric.</p>', html_url: 'https://canvas.example.edu/courses/2/discussion_topics/72' },
    { id: 73, title: 'Reading list updated', posted_at: hoursAgo(80), context_code: 'course_3', user_name: 'Research Methods team', read_state: 'read', message: '<p>Two papers added for week 9.</p>', html_url: null },
  ];
}

// A slice of Instructure's school directory, test sites and doubles included as they appear there.
const schools = [
  { name: 'Hampden - Sydney', domain: 'hsc.instructure.com' },
  { name: 'HKUST', domain: 'canvas.ust.hk' },
  { name: 'MLC School Sydney - Students and Teachers', domain: 'mlcsyd.instructure.com' },
  { name: 'The Hong Kong University of Science and Technology (GuangZhou)', domain: 'hkust-gz.instructure.com' },
  { name: 'The University of Melbourne', domain: 'canvas.lms.unimelb.edu.au' },
  { name: 'The University of Melbourne (non-SSO)', domain: 'canvas.lms.unimelb.edu.au' },
  { name: 'The University of Melbourne Online - Dev', domain: 'unimelb-online-dev.instructure.com' },
  { name: 'The University of Sydney', domain: 'canvas.sydney.edu.au' },
  { name: 'University of Technology Sydney', domain: 'canvas.uts.edu.au' },
  { name: 'Western Sydney University RTO', domain: 'wsucollege.instructure.com' },
];

/** What Canvas or a calendar feed would answer, or undefined for anything else. */
export async function reply(m: string, p: Record<string, unknown>, params = new URLSearchParams()): Promise<unknown> {
  switch (m) {
    case 'canvas.schools': {
      await new Promise((r) => setTimeout(r, 250));
      const name = (p.name as string).toLowerCase();
      return { status: 200, body: JSON.stringify(schools.filter((s) => s.name.toLowerCase().includes(name))), next: null };
    }
    case 'canvas.connect':
      return { status: 200, body: JSON.stringify({ id: 7, name: 'Jordan Lee' }), next: null };
    // ?notokenexpiry stands for a Canvas that will not say when the token expires.
    case 'canvas.token':
      return params.has('notokenexpiry') ? { status: 404, body: null, next: null } : { status: 200, body: JSON.stringify({ expires_at: day(88).toISOString() }), next: null };
    case 'canvas.get': {
      await new Promise((r) => setTimeout(r, 400));
      const path = p.path as string;
      const json = (body: unknown) => ({ status: 200, body: JSON.stringify(body), next: null });
      if (path.startsWith('/api/v1/courses?')) return json(courses);
      if (path === '/api/v1/users/self/profile') return json({ id: 7, name: 'Jordan Lee', avatar_url: null });
      if (path === '/api/v1/users/self/colors') return json({ custom_colors: { course_1: '#324A4D', course_2: '#0B874B', course_3: '#8E44AD' } });
      if (path.startsWith('/api/v1/calendar_events?')) return json(canvasEvents());
      if (path.startsWith('/api/v1/announcements?')) return json(announcements());
      const id = Number(/courses\/(\d+)/.exec(path)?.[1]);
      return { status: 200, body: JSON.stringify(assignments[id] ?? []), next: null };
    }
    case 'feed.add':
      return { status: 200, body: feed(), next: null, id: 'mockfeed', host: 'calendar.example.edu' };
    case 'feed.get':
      await new Promise((r) => setTimeout(r, 300));
      return { status: 200, body: feed(), next: null };
    default:
      return undefined;
  }
}
