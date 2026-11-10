import type { Institution, SchoolClass, Student, StudentAbsence, TimetableSlot } from '@/db/types';
import { classLessonsForDay, summarizeStudentAbsences, weekdayOfDate, type LessonSlot } from '@/utils/absences';
import { isSchoolDay, schoolDaysInMonth } from '@/utils/absenceReports';
import { classMonthlyHours } from '@/utils/absenceReports';

export interface ExcessiveStudent {
  studentId: string;
  fullName: string;
  className: string;
  boardingStatus: Student['boardingStatus'];
  totalHours: number;
  absenceRate: number | null;
  lastAbsenceDate: string;
}

export interface ExcessiveAbsenceConfig {
  thresholdType: 'hours' | 'percentage';
  thresholdValue: number;
}

export function getExcessiveAbsenceConfig(institution: Pick<Institution, 'absenceThresholdType' | 'absenceThresholdValue'>): ExcessiveAbsenceConfig {
  return {
    thresholdType: institution.absenceThresholdType ?? 'hours',
    thresholdValue: institution.absenceThresholdValue ?? 10,
  };
}

export function isStudentFlagged(hours: number, rate: number | null, config: ExcessiveAbsenceConfig): boolean {
  if (config.thresholdType === 'hours') return hours >= config.thresholdValue;
  if (rate === null) return false;
  return rate >= config.thresholdValue;
}

export function computeExcessiveAbsences(input: {
  students: Student[];
  classes: SchoolClass[];
  studentAbsences: StudentAbsence[];
  slots: LessonSlot[];
  workingDays: number[];
  holidayDates: string[];
  month: string;
  config: ExcessiveAbsenceConfig;
}): ExcessiveStudent[] {
  const { students, classes, studentAbsences, slots, workingDays, holidayDates, month, config } = input;
  const classNameById = new Map(classes.map((c) => [c.id, c.name]));
  const schoolDays = schoolDaysInMonth(month, workingDays, new Set(holidayDates));
  const monthPrefix = month;

  const monthAbsences = studentAbsences.filter((r) => r.date.startsWith(monthPrefix));
  const totalsByStudent = summarizeStudentAbsences(monthAbsences);

  const classHoursByClass = new Map<string, number>();
  for (const schoolClass of classes) {
    classHoursByClass.set(schoolClass.id, classMonthlyHours(slots, schoolClass.id, schoolDays));
  }

  const flagged: ExcessiveStudent[] = [];
  for (const student of students) {
    const totals = totalsByStudent.get(student.id);
    if (!totals || totals.hours === 0) continue;
    const classHours = classHoursByClass.get(student.classId) ?? 0;
    const rate = classHours > 0 ? Math.round((totals.hours * 100 / classHours) * 100) / 100 : null;
    if (!isStudentFlagged(totals.hours, rate, config)) continue;
    const studentRecords = monthAbsences
      .filter((r) => r.studentId === student.id)
      .map((r) => r.date)
      .sort();
    flagged.push({
      studentId: student.id,
      fullName: `${student.firstName} ${student.lastName}`,
      className: classNameById.get(student.classId) ?? '',
      boardingStatus: student.boardingStatus,
      totalHours: totals.hours,
      absenceRate: rate,
      lastAbsenceDate: studentRecords[studentRecords.length - 1] ?? '',
    });
  }

  flagged.sort((a, b) => b.totalHours - a.totalHours);
  return flagged;
}

export function computeExcessiveAbsencesForSchoolYear(input: {
  students: Student[];
  classes: SchoolClass[];
  studentAbsences: StudentAbsence[];
  slots: LessonSlot[];
  workingDays: number[];
  holidayDates: string[];
  schoolYearMonths: string[];
  config: ExcessiveAbsenceConfig;
}): ExcessiveStudent[] {
  const all: ExcessiveStudent[] = [];
  for (const month of input.schoolYearMonths) {
    all.push(
      ...computeExcessiveAbsences({
        students: input.students,
        classes: input.classes,
        studentAbsences: input.studentAbsences,
        slots: input.slots,
        workingDays: input.workingDays,
        holidayDates: input.holidayDates,
        month,
        config: input.config,
      }),
    );
  }
  const byStudent = new Map<string, ExcessiveStudent>();
  for (const student of all) {
    const existing = byStudent.get(student.studentId);
    if (!existing || student.totalHours > existing.totalHours) {
      byStudent.set(student.studentId, student);
    }
  }
  return [...byStudent.values()].sort((a, b) => b.totalHours - a.totalHours);
}

export function flagStudentIds(flagged: ExcessiveStudent[]): Set<string> {
  return new Set(flagged.map((s) => s.studentId));
}
