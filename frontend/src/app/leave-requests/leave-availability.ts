import { LeaveRequest } from '../models/leave-request.model';

export interface AvailableRange {
  startDate: string;
  endDate: string;
  days: number;
}

const DAY = 86400000;
const isoDate = (day: number): string => new Date(day).toISOString().slice(0, 10);

export function availableLeaveRanges(startDate: string, endDate: string, existing: LeaveRequest[]): AvailableRange[] {
  const start = Date.parse(startDate);
  const end = Date.parse(endDate);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return [];
  const blocked = existing.filter(request => request.status === 0 || request.status === 1)
    .map(request => [Math.max(start, Date.parse(request.startDate)), Math.min(end, Date.parse(request.endDate))])
    .filter(([from, to]) => from <= to).sort((a, b) => a[0] - b[0]);
  const ranges: AvailableRange[] = [];
  let cursor = start;
  const add = (from: number, to: number): void => {
    ranges.push({ startDate: isoDate(from), endDate: isoDate(to), days: (to - from) / DAY + 1 });
  };
  for (const [from, to] of blocked) {
    if (from > cursor) add(cursor, from - DAY);
    cursor = Math.max(cursor, to + DAY);
  }
  if (cursor <= end) add(cursor, end);
  return ranges;
}
