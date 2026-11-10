import { db } from './database';
import { assertHeadActor } from './users';
import type { DailyReportRecord, ParentCorrespondenceRow, SupervisorAbsenceRow } from './types';

export type DailyReportInput = {
  reportNumber: string;
  schoolYear: string;
  parentRows: ParentCorrespondenceRow[];
  counselorNotes: string;
  observationsActions: string;
  canteenNote: string;
  mealServed: string;
  plannedMeal: string;
  supervisorRows: SupervisorAbsenceRow[];
  teacherNotes: Record<string, string>;
};

export function dailyReportId(institutionId: string, date: string): string {
  return `${institutionId}|${date}`;
}

export function loadDailyReport(institutionId: string, date: string): Promise<DailyReportRecord | undefined> {
  return db.dailyReports.get(dailyReportId(institutionId, date));
}

export async function saveDailyReport(
  institutionId: string,
  date: string,
  input: DailyReportInput,
  actorId: string,
): Promise<void> {
  await assertHeadActor(actorId);
  await db.dailyReports.put({
    ...input,
    id: dailyReportId(institutionId, date),
    institutionId,
    date,
    updatedAt: new Date().toISOString(),
  });
}

export async function saveCanteenDailyInfo(
  institutionId: string,
  date: string,
  patch: { mealServed?: string; plannedMeal?: string; canteenNote?: string; supervisorRows?: SupervisorAbsenceRow[] },
  actorId: string,
): Promise<void> {
  await assertHeadActor(actorId);
  const id = dailyReportId(institutionId, date);
  const existing = await db.dailyReports.get(id);
  const reportNumberPrefix = '';
  const record: DailyReportRecord = existing
    ? { ...existing, ...patch, updatedAt: new Date().toISOString() }
    : {
        id,
        institutionId,
        date,
        reportNumber: reportNumberPrefix,
        schoolYear: '',
        parentRows: [],
        counselorNotes: '',
        observationsActions: '/',
        canteenNote: '',
        mealServed: '',
        plannedMeal: '',
        supervisorRows: patch.supervisorRows ?? [],
        teacherNotes: {},
        updatedAt: new Date().toISOString(),
      };
  if (patch.mealServed !== undefined) record.mealServed = patch.mealServed;
  if (patch.plannedMeal !== undefined) record.plannedMeal = patch.plannedMeal;
  if (patch.canteenNote !== undefined) record.canteenNote = patch.canteenNote;
  if (patch.supervisorRows !== undefined) record.supervisorRows = patch.supervisorRows;
  await db.dailyReports.put(record);
}
