import { describe, expect, it } from 'vitest';
import { parseFeed } from './ics';

// vite.config.ts pins TZ to Australia/Sydney, where DST starts on 2026-10-04.
const range = [new Date(2026, 7, 1), new Date(2027, 1, 1)] as const;
const cal = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Uni\\, Sem 2\r\n${body}\r\nEND:VCALENDAR\r\n`;
const local = (iso: string) => new Date(iso).toLocaleString('sv-SE', { timeZone: 'Australia/Sydney' });

describe('parseFeed', () => {
  it('reads UTC events, folded lines and escapes, and leaves Canvas assignment copies to the API', () => {
    const feed = parseFeed(
      cal(
        [
          'BEGIN:VEVENT',
          'UID:event-calendar-event-1',
          'DTSTART:20260929T080000Z',
          'DTEND:20260929T090000Z',
          'SUMMARY:PMGT5850 Capstone\\, week 9',
          'LOCATION:Fisher',
          '  Library',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:event-assignment-687477',
          'DTSTART:20260831T135959Z',
          'SUMMARY:A2 - Project Charter',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      ...range,
      true,
    );
    expect(feed.name).toBe('Uni, Sem 2');
    expect(feed.skippedAssignments).toBe(1);
    expect(feed.events).toHaveLength(1);
    expect(feed.events[0]).toMatchObject({ title: 'PMGT5850 Capstone, week 9', location: 'Fisher Library', allDay: false });
    expect(local(feed.events[0].start)).toBe('2026-09-29 18:00:00');
    expect(local(feed.events[0].end!)).toBe('2026-09-29 19:00:00');
  });

  it('keeps assignment copies when no Canvas account owns them', () => {
    const feed = parseFeed(cal('BEGIN:VEVENT\r\nUID:event-assignment-1\r\nDTSTART:20260901T000000Z\r\nSUMMARY:Quiz\r\nEND:VEVENT'), ...range, false);
    expect(feed.events).toHaveLength(1);
  });

  it('expands a weekly zoned lecture across the DST change at the same wall time', () => {
    const feed = parseFeed(
      cal(
        [
          'BEGIN:VEVENT',
          'UID:lecture',
          'DTSTART;TZID=Australia/Sydney:20260924T100000',
          'DTEND;TZID=Australia/Sydney:20260924T120000',
          'RRULE:FREQ=WEEKLY;COUNT=4',
          'EXDATE;TZID=Australia/Sydney:20261001T100000',
          'SUMMARY:Lecture',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:lecture',
          'RECURRENCE-ID;TZID=Australia/Sydney:20261008T100000',
          'DTSTART;TZID=Australia/Sydney:20261008T140000',
          'DTEND;TZID=Australia/Sydney:20261008T150000',
          'SUMMARY:Lecture (moved)',
          'END:VEVENT',
        ].join('\r\n'),
      ),
      ...range,
      true,
    );
    expect(feed.events.map((e) => [e.title, local(e.start)])).toEqual([
      ['Lecture', '2026-09-24 10:00:00'],
      ['Lecture (moved)', '2026-10-08 14:00:00'],
      ['Lecture', '2026-10-15 10:00:00'],
    ]);
  });

  it('maps Windows zone names and falls back to VTIMEZONE rules for unknown ids', () => {
    const vtimezone = [
      'BEGIN:VTIMEZONE',
      'TZID:Custom Eastern',
      'BEGIN:STANDARD',
      'DTSTART:16010101T030000',
      'TZOFFSETFROM:+1100',
      'TZOFFSETTO:+1000',
      'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=4',
      'END:STANDARD',
      'BEGIN:DAYLIGHT',
      'DTSTART:16010101T020000',
      'TZOFFSETFROM:+1000',
      'TZOFFSETTO:+1100',
      'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=10',
      'END:DAYLIGHT',
      'END:VTIMEZONE',
    ].join('\r\n');
    const feed = parseFeed(
      cal(
        [
          vtimezone,
          'BEGIN:VEVENT\r\nUID:a\r\nDTSTART;TZID=AUS Eastern Standard Time:20261010T090000\r\nSUMMARY:Windows\r\nEND:VEVENT',
          'BEGIN:VEVENT\r\nUID:b\r\nDTSTART;TZID=Custom Eastern:20261010T090000\r\nSUMMARY:Custom summer\r\nEND:VEVENT',
          'BEGIN:VEVENT\r\nUID:c\r\nDTSTART;TZID=Custom Eastern:20260910T090000\r\nSUMMARY:Custom winter\r\nEND:VEVENT',
        ].join('\r\n'),
      ),
      ...range,
      true,
    );
    const byTitle = Object.fromEntries(feed.events.map((e) => [e.title, local(e.start)]));
    expect(byTitle).toEqual({
      Windows: '2026-10-10 09:00:00',
      'Custom summer': '2026-10-10 09:00:00',
      'Custom winter': '2026-09-10 09:00:00',
    });
  });

  it('reads all-day spans with an exclusive end day', () => {
    const feed = parseFeed(
      cal(
        [
          'BEGIN:VEVENT\r\nUID:break\r\nDTSTART;VALUE=DATE:20261001\r\nDTEND;VALUE=DATE:20261006\r\nSUMMARY:Mid-semester break\r\nEND:VEVENT',
          'BEGIN:VEVENT\r\nUID:day\r\nDTSTART;VALUE=DATE:20260925\r\nSUMMARY:One day\r\nEND:VEVENT',
        ].join('\r\n'),
      ),
      ...range,
      true,
    );
    expect(feed.events.map((e) => [e.title, e.start, e.end, e.allDay])).toEqual([
      ['One day', '2026-09-25', null, true],
      ['Mid-semester break', '2026-10-01', '2026-10-06', true],
    ]);
  });

  it('expands monthly last-Friday rules and drops cancelled occurrences', () => {
    const feed = parseFeed(
      cal(
        [
          'BEGIN:VEVENT\r\nUID:m\r\nDTSTART;TZID=Australia/Sydney:20260828T160000\r\nRRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3\r\nSUMMARY:Review\r\nEND:VEVENT',
          'BEGIN:VEVENT\r\nUID:m\r\nRECURRENCE-ID;TZID=Australia/Sydney:20260925T160000\r\nDTSTART;TZID=Australia/Sydney:20260925T160000\r\nSTATUS:CANCELLED\r\nSUMMARY:Review\r\nEND:VEVENT',
        ].join('\r\n'),
      ),
      ...range,
      true,
    );
    expect(feed.events.map((e) => local(e.start))).toEqual(['2026-08-28 16:00:00', '2026-10-30 16:00:00']);
  });

  it('tells 11 January from 1 November in all-day recurrences, and keys every row once', () => {
    const feed = parseFeed(
      cal(
        [
          'BEGIN:VEVENT\r\nUID:m\r\nDTSTART;VALUE=DATE:20260111\r\nRRULE:FREQ=MONTHLY;BYMONTHDAY=1,11;COUNT=24\r\nEXDATE;VALUE=DATE:20261101\r\nSUMMARY:Stamp\r\nEND:VEVENT',
          'BEGIN:VEVENT\r\nUID:dup\r\nDTSTART;VALUE=DATE:20260301\r\nSUMMARY:First\r\nEND:VEVENT',
          'BEGIN:VEVENT\r\nUID:dup\r\nDTSTART;VALUE=DATE:20260302\r\nSUMMARY:Second\r\nEND:VEVENT',
        ].join('\r\n'),
      ),
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
      true,
    );
    // Unpadded, the excluded 1 November read as "2026111" and took 11 January with it.
    const stamps = feed.events.filter((e) => e.title === 'Stamp').map((e) => e.start);
    expect(stamps).toHaveLength(22);
    expect(stamps).toContain('2026-01-11');
    expect(stamps).not.toContain('2026-11-01');
    expect(feed.events.find((e) => e.start === '2026-02-01')?.key).toBe('m|20260201');
    expect(feed.events.filter((e) => e.title !== 'Stamp').map((e) => [e.key, e.start])).toEqual([
      ['dup', '2026-03-01'],
      ['dup#2', '2026-03-02'],
    ]);
    expect(new Set(feed.events.map((e) => e.key)).size).toBe(feed.events.length);
  });
});
