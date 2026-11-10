import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Utensils, Users, ClipboardList, Save } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { FormError } from '@/components/ui/StatusBlock';
import { loadDailyReport, saveCanteenDailyInfo } from '@/db/dailyReports';
import { listSupervisors } from '@/db/users';
import { useSession } from '@/modules/auth/AuthContext';
import { errorKey } from '@/utils/errors';
import { todayIso } from '@/utils/dates';
import { SUPERVISOR_ATTENDANCE, type SupervisorAbsenceRow, type SupervisorAttendance, type User } from '@/db/types';

const INPUT_CLASS =
  'min-h-11 w-full rounded-xl border border-neutral-300 bg-white px-3 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200';

type SaveState = 'idle' | 'saving' | 'saved' | 'failed';

function emptySupervisorRow(): SupervisorAbsenceRow {
  return { supervisorId: null, name: '', morning: 'none', evening: 'none', notes: '' };
}

export function CanteenDailyInfo() {
  const { t } = useTranslation();
  const { user, institution } = useSession();
  const today = todayIso();
  const [date, setDate] = useState(today);
  const [mealServed, setMealServed] = useState('');
  const [canteenNote, setCanteenNote] = useState('');
  const [supervisorRows, setSupervisorRows] = useState<SupervisorAbsenceRow[]>([]);
  const [supervisors, setSupervisors] = useState<User[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [error, setError] = useState<string | null>(null);
  const canEdit = user.role === 'head';

  const load = useCallback(async () => {
    setLoaded(false);
    setError(null);
    try {
      const [report, supervisorList] = await Promise.all([
        loadDailyReport(institution.id, date),
        listSupervisors(institution.id),
      ]);
      setMealServed(report?.mealServed ?? '');
      setCanteenNote(report?.canteenNote ?? '');
      setSupervisorRows(report?.supervisorRows ?? []);
      setSupervisors(supervisorList);
      setDirty(false);
      setSaveState('idle');
    } catch (loadError) {
      setError(t(errorKey(loadError)));
    } finally {
      setLoaded(true);
    }
  }, [institution.id, date, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const updateRow = (index: number, patch: Partial<SupervisorAbsenceRow>) =>
    setSupervisorRows((previous) => previous.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const pickSupervisor = (index: number, supervisorId: string) => {
    const supervisor = supervisors.find((item) => item.id === supervisorId);
    updateRow(index, supervisor ? { supervisorId: supervisor.id, name: supervisor.name } : { supervisorId: null, name: '' });
  };

  const handleSave = async () => {
    setSaveState('saving');
    setError(null);
    try {
      await saveCanteenDailyInfo(institution.id, date, { mealServed, canteenNote, supervisorRows }, user.id);
      setDirty(false);
      setSaveState('saved');
    } catch (saveError) {
      setSaveState('failed');
      setError(t(errorKey(saveError)));
    }
  };

  if (!canEdit) {
    return (
      <div className="flex flex-col gap-4 rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-neutral-200">
        <p className="text-sm text-neutral-500">{t('canteenDailyInfo.readOnly')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
        <div className="mb-4 flex items-center gap-2">
          <Utensils className="size-5 text-primary-600" aria-hidden />
          <h2 className="text-lg font-bold text-neutral-900">{t('canteenDailyInfo.title')}</h2>
        </div>

        <label className="mb-4 flex flex-col gap-1 text-sm font-medium text-neutral-700">
          {t('canteenDailyInfo.date')}
          <input
            type="date"
            value={date}
            onChange={(event) => { setDate(event.target.value); }}
            className={INPUT_CLASS}
          />
        </label>

        {loaded ? (
          <div className="flex flex-col gap-5">
            <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
              {t('canteenDailyInfo.mealServed')}
              <textarea
                value={mealServed}
                rows={2}
                placeholder={t('canteenDailyInfo.mealPlaceholder')}
                onChange={(event) => { setMealServed(event.target.value); setDirty(true); setSaveState('idle'); }}
                className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
              <span className="flex items-center gap-1.5">
                <ClipboardList className="size-4 text-neutral-500" aria-hidden />
                {t('canteenDailyInfo.notes')}
              </span>
              <textarea
                value={canteenNote}
                rows={3}
                placeholder={t('canteenDailyInfo.notesPlaceholder')}
                onChange={(event) => { setCanteenNote(event.target.value); setDirty(true); setSaveState('idle'); }}
                className="w-full rounded-xl border border-neutral-300 bg-white p-3 text-base text-neutral-900 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200"
              />
            </label>
          </div>
        ) : (
          <p className="text-sm text-neutral-500">{t('common.loading')}</p>
        )}
      </div>

      {loaded ? (
        <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200">
          <div className="mb-4 flex items-center gap-2">
            <Users className="size-5 text-primary-600" aria-hidden />
            <h2 className="text-lg font-bold text-neutral-900">{t('canteenDailyInfo.supervisors')}</h2>
          </div>

          <div className="flex flex-col gap-3">
            {supervisorRows.length === 0 ? (
              <p className="text-sm text-neutral-500">{t('canteenDailyInfo.noSupervisors')}</p>
            ) : null}
            {supervisorRows.map((row, index) => (
              <div key={index} className="flex flex-col gap-3 rounded-xl border border-neutral-200 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-neutral-700">{t('dailyReport.rowNumber', { n: index + 1 })}</span>
                  <Button variant="ghost" onClick={() => { setSupervisorRows((prev) => prev.filter((_, i) => i !== index)); setDirty(true); setSaveState('idle'); }}>
                    {t('dailyReport.removeRow')}
                  </Button>
                </div>
                <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
                  {t('dailyReport.chooseSupervisor')}
                  <select className={INPUT_CLASS} value={row.supervisorId ?? ''} onChange={(event) => { pickSupervisor(index, event.target.value); setDirty(true); setSaveState('idle'); }}>
                    <option value="">{t('dailyReport.chooseSupervisor')}</option>
                    {supervisors.map((supervisor) => (
                      <option key={supervisor.id} value={supervisor.id}>{supervisor.name}</option>
                    ))}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
                    {t('dailyReport.morning')}
                    <select className={INPUT_CLASS} value={row.morning} onChange={(event) => { updateRow(index, { morning: event.target.value as SupervisorAttendance }); setDirty(true); setSaveState('idle'); }}>
                      {SUPERVISOR_ATTENDANCE.map((option) => (
                        <option key={option} value={option}>
                          {option === 'none' ? t('dailyReport.attendanceNone') : option === 'absent' ? t('dailyReport.attendanceAbsent') : t('dailyReport.attendanceLate')}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
                    {t('dailyReport.evening')}
                    <select className={INPUT_CLASS} value={row.evening} onChange={(event) => { updateRow(index, { evening: event.target.value as SupervisorAttendance }); setDirty(true); setSaveState('idle'); }}>
                      {SUPERVISOR_ATTENDANCE.map((option) => (
                        <option key={option} value={option}>
                          {option === 'none' ? t('dailyReport.attendanceNone') : option === 'absent' ? t('dailyReport.attendanceAbsent') : t('dailyReport.attendanceLate')}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <label className="flex flex-col gap-1 text-sm font-medium text-neutral-700">
                  {t('dailyReport.notes')}
                  <input className={INPUT_CLASS} value={row.notes} onChange={(event) => { updateRow(index, { notes: event.target.value }); setDirty(true); setSaveState('idle'); }} />
                </label>
              </div>
            ))}
            <Button variant="secondary" fullWidth onClick={() => { setSupervisorRows((prev) => [...prev, emptySupervisorRow()]); setDirty(true); setSaveState('idle'); }}>
              {t('dailyReport.addRow')}
            </Button>
          </div>
        </div>
      ) : null}

      {loaded ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleSave} disabled={!dirty || saveState === 'saving'}>
            <span className="flex items-center gap-2">
              <Save className="size-4" aria-hidden />
              {saveState === 'saving' ? t('canteenDailyInfo.saving') : t('canteenDailyInfo.save')}
            </span>
          </Button>
          {saveState === 'saved' ? <span className="text-sm font-medium text-success-700">{t('dailyReport.saved')}</span> : null}
          {saveState === 'failed' ? <span className="text-sm font-medium text-danger-700">{t('dailyReport.saveFailed')}</span> : null}
          {dirty ? <span className="text-sm font-medium text-warning-700">{t('dailyReport.unsaved')}</span> : null}
        </div>
      ) : null}

      <FormError message={error} />

      <p className="text-sm text-neutral-500">{t('canteenDailyInfo.linkedToReport')}</p>
    </div>
  );
}
