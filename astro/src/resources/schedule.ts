import scheduleMap from '../static/schedule.json' with { type: "json" };
import groupMap from '../static/groups.json' with { type: "json" };  
import type { ESPNScheduleEntry } from './espn';

export type ScheduleWeek = ESPNScheduleEntry & {
    year: string;
    type: string;
}
export type ScheduleMap = Record<string, ScheduleWeek[]>
export const GLOBAL_SCHEDULE_MAP: ScheduleMap = (scheduleMap as ScheduleMap);

export interface ScheduleGroup {
    id: number;
    name: string;
}
export const GLOBAL_GROUP_LIST: ScheduleGroup[] = (groupMap as ScheduleGroup[]);

